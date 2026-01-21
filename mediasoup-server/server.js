/**
 * MediaSoup WebRTC Server for VAS
 * 
 * Handles RTSP → WebRTC conversion with <500ms latency
 */

const mediasoup = require('mediasoup');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const config = {
  listenIp: '0.0.0.0',
  listenPort: 3001,
  
  // MediaSoup settings optimized for low latency
  mediasoup: {
    numWorkers: 2,
    worker: {
      rtcMinPort: 20000,
      rtcMaxPort: 20999,
      logLevel: 'debug',  // Enable debug logging to see RTP packet details
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',  // Critical for debugging RTP packet reception
        'srtp',
        'rtcp',
      ],
    },
    router: {
      mediaCodecs: [
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
          },
        },
        // Audio removed - cameras don't support audio
      ],
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '10.30.250.99', // Server's public IP
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxIncomingBitrate: 1500000
    },
    plainRtpTransport: {
      listenIp: { ip: '0.0.0.0', announcedIp: null },
      rtcpMux: true,  // Enable RTCP muxing so RTP and RTCP share same port (matches FFmpeg output)
      comedia: true,
    },
  },
};

// Global state
let workers = [];
let workerIndex = 0;
const routers = new Map();
const producers = new Map();
const transports = new Map();
const consumers = new Map();
const rooms = new Map(); // roomId -> { routerId, producerIds }

/**
 * Initialize MediaSoup workers
 */
async function createWorkers() {
  const numWorkers = config.mediasoup.numWorkers;
  
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      ...config.mediasoup.worker,
      appData: { workerId: i },
    });
    
    worker.on('died', () => {
      console.error(`MediaSoup worker died, exiting in 2 seconds... [workerId: ${i}]`);
      setTimeout(() => process.exit(1), 2000);
    });
    
    workers.push(worker);
    console.log(`MediaSoup worker created [workerId: ${i}, pid: ${worker.pid}]`);
  }
}

/**
 * Get next worker using round-robin
 */
function getNextWorker() {
  const worker = workers[workerIndex];
  workerIndex = (workerIndex + 1) % workers.length;
  return worker;
}

/**
 * Create a router for a room/device
 */
async function createRouter(roomId) {
  if (routers.has(roomId)) {
    return routers.get(roomId);
  }
  
  const worker = getNextWorker();
  const router = await worker.createRouter({
    mediaCodecs: config.mediasoup.router.mediaCodecs,
  });
  
  routers.set(roomId, router);
  rooms.set(roomId, {
    routerId: router.id,
    producerIds: [],
  });
  
  console.log(`Router created for room: ${roomId}`);
  return router;
}

/**
 * Get a deterministic port for a room based on its ID.
 * Port range: 20100-20999 (900 ports available)
 */
function getPortForRoom(roomId) {
  // Use a simple hash of the room ID to get a port
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    const char = roomId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return 20100 + (Math.abs(hash) % 900);
}

/**
 * Create PlainRtpTransport for FFmpeg input
 * Can optionally specify a fixed port (used when SSRC was pre-captured)
 */
async function createPlainRtpTransport(roomId, fixedPort = null) {
  const router = await createRouter(roomId);

  // Clean up existing producers and PlainRTP transports for this room
  // This prevents accumulation of stale producers when streams restart
  const room = rooms.get(roomId);
  if (room && room.producerIds && room.producerIds.length > 0) {
    console.log(`Cleaning up ${room.producerIds.length} existing producer(s) for room: ${roomId}`);
    for (const producerId of [...room.producerIds]) {
      const producerData = producers.get(producerId);
      if (producerData) {
        try {
          producerData.producer.close();
          producers.delete(producerId);
          console.log(`  Closed producer: ${producerId}`);
        } catch (err) {
          console.warn(`  Failed to close producer ${producerId}: ${err.message}`);
        }
      }
    }
    room.producerIds = [];
  }

  // Close existing PlainRTP transports for this room
  for (const [tid, tdata] of transports.entries()) {
    if (tdata.roomId === roomId && tdata.type === 'plain') {
      try {
        tdata.transport.close();
        transports.delete(tid);
        console.log(`  Closed old PlainRTP transport: ${tid}`);
      } catch (err) {
        console.warn(`  Failed to close transport ${tid}: ${err.message}`);
      }
    }
  }

  // Create transport with optional fixed port
  const transportOptions = {
    listenInfo: {
      protocol: 'udp',
      ip: '0.0.0.0',
    },
    rtcpMux: true,  // RTP and RTCP on same port
    comedia: false, // Disable comedia - we'll connect explicitly
  };

  // Add fixed port if specified
  if (fixedPort) {
    transportOptions.listenInfo.port = fixedPort;
    console.log(`Creating PlainRtpTransport with fixed port: ${fixedPort}`);
  }

  const transport = await router.createPlainTransport(transportOptions);

  const transportId = transport.id;
  transports.set(transportId, { transport, roomId, type: 'plain' });

  console.log(`PlainRtpTransport created [room: ${roomId}, transport: ${transportId}]`);
  console.log(`RTP: ${transport.tuple.localIp}:${transport.tuple.localPort}`);

  // When rtcpMux is true, rtcpTuple doesn't exist (RTCP is on same port as RTP)
  const rtcpTuple = transport.rtcpTuple;
  if (rtcpTuple) {
    console.log(`RTCP: ${rtcpTuple.localIp}:${rtcpTuple.localPort}`);
  } else {
    console.log(`RTCP: muxed (same port as RTP)`);
  }

  return {
    id: transportId,
    ip: transport.tuple.localIp,
    port: transport.tuple.localPort,
    rtcpPort: rtcpTuple ? rtcpTuple.localPort : transport.tuple.localPort, // Same port if muxed
  };
}

/**
 * Connect PlainRtpTransport to remote endpoint (FFmpeg source)
 * This must be called BEFORE creating a producer, so the transport knows
 * where to expect RTP packets from.
 */
async function connectPlainTransport(transportId, ip, port, rtcpPort = null) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport not found: ${transportId}`);
  }

  const { transport } = transportData;

  // Connect the transport to the remote endpoint
  // For rtcpMux=true, we don't need rtcpPort
  const connectParams = { ip, port };
  if (rtcpPort && rtcpPort !== port) {
    connectParams.rtcpPort = rtcpPort;
  }

  await transport.connect(connectParams);

  console.log(`PlainRtpTransport connected [transport: ${transportId}, remote: ${ip}:${port}]`);

  return {
    connected: true,
    remoteIp: ip,
    remotePort: port,
  };
}

/**
 * Capture SSRC from incoming RTP packets on a port using a temporary UDP socket.
 * This is used to discover the actual SSRC FFmpeg is sending before creating a producer.
 *
 * NOTE: This captures packets BEFORE MediaSoup receives them, so MediaSoup transport
 * must NOT be listening on this port yet, OR we need to use a different approach.
 *
 * Better approach: Read SSRC from MediaSoup's warning logs or use transport stats.
 */
const dgram = require('dgram');

async function captureSSRC(port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.close();
        resolve(null); // Return null on timeout instead of rejecting
      }
    }, timeoutMs);

    socket.on('message', (msg, rinfo) => {
      if (!resolved && msg.length >= 12) {
        resolved = true;
        clearTimeout(timeout);

        // Extract SSRC (big-endian, 32-bit unsigned integer at offset 8)
        const ssrc = msg.readUInt32BE(8);
        console.log(`✅ Captured SSRC: ${ssrc} (0x${ssrc.toString(16)}) from ${rinfo.address}:${rinfo.port}`);

        // Close socket and wait a bit before resolving to ensure port is released
        socket.close(() => {
          // Add a small delay to ensure OS releases the port
          setTimeout(() => {
            console.log(`Socket closed, port ${port} should be released`);
            resolve(ssrc);
          }, 100);
        });
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.error(`SSRC capture error: ${err.message}`);
        socket.close();
        resolve(null);
      }
    });

    try {
      socket.bind(port, '0.0.0.0', () => {
        console.log(`Listening for RTP packets on port ${port} to capture SSRC...`);
      });
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.error(`Failed to bind to port ${port}: ${err.message}`);
        resolve(null);
      }
    }
  });
}

/**
 * Create Producer from PlainRtpTransport (FFmpeg input)
 */
async function createProducer(transportId, kind, rtpParameters) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport not found: ${transportId}`);
  }
  
  const { transport, roomId } = transportData;
  
  const producer = await transport.produce({
    kind,
    rtpParameters,
  });
  
  // Enable trace events for detailed RTP debugging
  try {
    transport.enableTraceEvent(['probation', 'rtp', 'keyframe']);
    producer.enableTraceEvent(['keyframe', 'rtp']);
    console.log(`✅ Trace events enabled for producer ${producer.id}`);
  } catch (err) {
    console.warn(`⚠️  Could not enable trace events: ${err.message}`);
  }
  
  // Listen for trace events - just log the type, no JSON serialization
  producer.on('trace', (trace) => {
    // Minimal logging to avoid BigInt serialization issues
    // Trace events firing proves packets are reaching the producer
  });
  
  transport.on('tuple', (tuple) => {
    console.log(`[TRANSPORT TUPLE] Transport ${transportId}:`, JSON.stringify(tuple, null, 2));
  });
  
  producers.set(producer.id, { producer, roomId, transportId });
  
  const room = rooms.get(roomId);
  room.producerIds.push(producer.id);
  
  console.log(`Producer created [room: ${roomId}, kind: ${kind}, producer: ${producer.id}]`);
  console.log(`Producer RTP params: mid=${rtpParameters.mid || 'N/A'}, payloadType=${rtpParameters.codecs?.[0]?.payloadType || 'N/A'}, SSRC=${rtpParameters.encodings?.[0]?.ssrc || 'auto-detect'}`);
  
  // Log producer and transport stats after a delay to check if packets are being received
  setTimeout(async () => {
    // Helper to safely convert BigInt to Number
    const toNumber = (val) => typeof val === 'bigint' ? Number(val) : (val || 0);

    try {
      // For PlainRTP, get stats from both transport and producer
      const transportStats = await transport.getStats();
      const producerStats = await producer.getStats();

      console.log(`\n=== Stats for Producer ${producer.id} ===`);
      console.log(`Transport stats types: [${transportStats.map(s => s.type).join(', ')}]`);
      console.log(`Producer stats types: [${producerStats.map(s => s.type).join(', ')}]`);

      // Find inbound-rtp stats (PlainRTP transport receives RTP, producer consumes it)
      const inboundRtp = [...transportStats, ...producerStats].find(s => s.type === 'inbound-rtp');
      const transportStat = transportStats.find(s => s.type === 'transport');

      if (inboundRtp) {
        const packetsReceived = toNumber(inboundRtp.packetsReceived);
        const bytesReceived = toNumber(inboundRtp.bytesReceived);
        const ssrc = inboundRtp.ssrc;

        console.log(`✅ Inbound RTP found:`);
        console.log(`   packetsReceived: ${packetsReceived} (type: ${typeof inboundRtp.packetsReceived})`);
        console.log(`   bytesReceived: ${bytesReceived}`);
        console.log(`   ssrc: ${ssrc || 'N/A'}`);
        console.log(`   expected ssrc: ${rtpParameters.encodings?.[0]?.ssrc || 'N/A'}`);

        if (ssrc) {
          const expectedSsrc = rtpParameters.encodings?.[0]?.ssrc;
          if (expectedSsrc && ssrc !== expectedSsrc) {
            console.warn(`⚠️  SSRC MISMATCH! Expected ${expectedSsrc}, got ${ssrc}`);
          } else if (expectedSsrc) {
            console.log(`✅ SSRC matches: ${ssrc}`);
          }
        }

        if (packetsReceived === 0) {
          console.warn(`⚠️  WARNING: No packets received despite FFmpeg running!`);
        } else {
          console.log(`✅ Producer IS receiving packets (${packetsReceived} packets)`);
        }
      } else {
        console.warn(`⚠️  No inbound-rtp stats found! Producer may not be receiving packets.`);

        // Check transport tuple to verify remote endpoint
        const plainRtpStat = transportStats.find(s => s.type === 'plain-rtp-transport');
        if (plainRtpStat && plainRtpStat.tuple) {
          console.log(`Transport tuple: local=${plainRtpStat.tuple.localIp}:${plainRtpStat.tuple.localPort}, remote=${plainRtpStat.tuple.remoteIp}:${plainRtpStat.tuple.remotePort}`);
          if (!plainRtpStat.tuple.remoteIp || plainRtpStat.tuple.remoteIp === '0.0.0.0') {
            console.warn(`⚠️  Transport tuple not set - comedia may not have detected remote endpoint yet`);
          }
        }
      }

      // Log plain-rtp-transport stats which shows actual bytes received at transport level
      const plainRtpStat = transportStats.find(s => s.type === 'plain-rtp-transport');
      if (plainRtpStat) {
        console.log(`PlainRTP transport stats:`);
        console.log(`   bytesReceived: ${toNumber(plainRtpStat.bytesReceived)}`);
        console.log(`   rtpBytesReceived: ${toNumber(plainRtpStat.rtpBytesReceived)}`);
        console.log(`   rtpRecvBitrate: ${toNumber(plainRtpStat.recvBitrate)}`);
      }
      console.log(`=== End Stats ===\n`);
    } catch (err) {
      console.error(`Failed to get stats: ${err.message}`);
      console.error(err.stack);
    }
  }, 7000); // Wait 7 seconds after creation to ensure packets have time to arrive
  
  return {
    id: producer.id,
    kind: producer.kind,
  };
}

/**
 * Create WebRTC transport for consumer (browser)
 */
async function createWebRtcTransport(roomId) {
  const router = routers.get(roomId);
  if (!router) {
    throw new Error(`Router not found for room: ${roomId}`);
  }
  
  const transport = await router.createWebRtcTransport({
    ...config.mediasoup.webRtcTransport,
  });
  
  const transportId = transport.id;
  transports.set(transportId, { transport, roomId, type: 'webrtc' });
  
  console.log(`WebRtcTransport created [room: ${roomId}, transport: ${transportId}]`);
  
  return {
    id: transportId,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

/**
 * Connect WebRTC transport
 */
async function connectWebRtcTransport(transportId, dtlsParameters) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport not found: ${transportId}`);
  }
  
  await transportData.transport.connect({ dtlsParameters });
  console.log(`WebRtcTransport connected [transport: ${transportId}]`);
}

/**
 * Get transport statistics
 */
async function getTransportStats(transportId) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport not found: ${transportId}`);
  }
  
  const stats = await transportData.transport.getStats();
  return stats;
}

/**
 * Create Consumer (send to browser)
 */
async function createConsumer(transportId, producerId, rtpCapabilities) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport not found: ${transportId}`);
  }
  
  const { transport, roomId } = transportData;
  const router = routers.get(roomId);
  
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('Cannot consume');
  }
  
  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: false,
  });
  
  consumers.set(consumer.id, { consumer, transportId, producerId });
  
  console.log(`Consumer created [room: ${roomId}, consumer: ${consumer.id}, producer: ${producerId}]`);
  
  return {
    id: consumer.id,
    producerId: producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

/**
 * WebSocket handling
 */
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { type, payload } = data;
      
      console.log(`WebSocket message: ${type}`);
      
      let response = {};
      
      switch (type) {
        case 'getRouterRtpCapabilities':
          {
            const { roomId } = payload;
            const router = await createRouter(roomId);
            response = {
              type: 'routerRtpCapabilities',
              rtpCapabilities: router.rtpCapabilities,
            };
          }
          break;
        
        case 'createPlainRtpTransport':
          {
            const { roomId, fixedPort } = payload;
            const transportInfo = await createPlainRtpTransport(roomId, fixedPort);
            response = {
              type: 'plainRtpTransportCreated',
              transportInfo,
            };
          }
          break;

        case 'getPortForRoom':
          {
            // Get the deterministic port for a room (doesn't bind, just returns the port number)
            const { roomId } = payload;
            const port = getPortForRoom(roomId);
            response = {
              type: 'portForRoom',
              roomId,
              port,
            };
          }
          break;

        case 'captureSSRC':
          {
            // Capture SSRC from incoming RTP packets on a specific port.
            // This binds to the port, waits for first packet, extracts SSRC, and closes the socket.
            // The caller should:
            // 1. Call getPortForRoom to get the port
            // 2. Call this (captureSSRC) to start listening - it will wait for packets
            // 3. In parallel, start FFmpeg sending to this port
            // 4. This returns when SSRC is captured (or timeout)
            // 5. Call createPlainRtpTransport with fixedPort
            // 6. Connect transport and create producer with SSRC
            const { port, timeoutMs = 8000 } = payload;

            console.log(`Starting SSRC capture on port ${port}...`);

            // Start capturing SSRC on this port
            const ssrc = await captureSSRC(port, timeoutMs);

            response = {
              type: 'ssrcCaptured',
              port,
              ssrc,
              success: ssrc !== null,
            };

            if (ssrc !== null) {
              console.log(`✅ SSRC captured on port ${port}: ${ssrc}`);
            } else {
              console.warn(`⚠️  Failed to capture SSRC on port ${port}`);
            }
          }
          break;

        case 'connectPlainTransport':
          {
            const { transportId, ip, port, rtcpPort } = payload;
            const connectInfo = await connectPlainTransport(transportId, ip, port, rtcpPort);
            response = {
              type: 'plainTransportConnected',
              ...connectInfo,
            };
          }
          break;

        case 'getTransportStats':
          {
            const { transportId } = payload;
            const stats = await getTransportStats(transportId);
            response = {
              type: 'transportStats',
              stats: stats,
            };
          }
          break;
        
        case 'createProducer':
          {
            const { transportId, kind, rtpParameters } = payload;
            const producerInfo = await createProducer(transportId, kind, rtpParameters);
            response = {
              type: 'producerCreated',
              producerInfo,
            };
          }
          break;
        
        case 'createWebRtcTransport':
          {
            const { roomId } = payload;
            const transportInfo = await createWebRtcTransport(roomId);
            response = {
              type: 'webRtcTransportCreated',
              transportInfo,
            };
          }
          break;
        
        case 'connectWebRtcTransport':
          {
            const { transportId, dtlsParameters } = payload;
            await connectWebRtcTransport(transportId, dtlsParameters);
            response = {
              type: 'webRtcTransportConnected',
            };
          }
          break;
        
        case 'consume':
          {
            const { transportId, producerId, rtpCapabilities } = payload;
            const consumerInfo = await createConsumer(transportId, producerId, rtpCapabilities);
            response = {
              type: 'consumerCreated',
              consumerInfo,
            };
          }
          break;
        
        case 'getProducers':
          {
            const { roomId } = payload;
            const room = rooms.get(roomId);
            response = {
              type: 'producersList',
              producers: room ? room.producerIds : [],
            };
          }
          break;

        case 'getProducerStats':
          {
            const { producerId } = payload;
            const producerData = producers.get(producerId);
            if (!producerData) {
              throw new Error(`Producer not found: ${producerId}`);
            }

            // Helper to safely convert BigInt to Number
            const toNumber = (val) => typeof val === 'bigint' ? Number(val) : (val || 0);

            const stats = await producerData.producer.getStats();
            const inboundRtp = stats.find(s => s.type === 'inbound-rtp');

            // Get transport stats - for PlainRtpTransport, this is where the real stats are
            const transportData = transports.get(producerData.transportId);
            let rtpPacketsReceived = 0;
            let rtpBytesReceived = 0;

            if (transportData) {
              const tStats = await transportData.transport.getStats();
              const plainRtp = tStats.find(s => s.type === 'plain-rtp-transport');
              if (plainRtp) {
                rtpBytesReceived = toNumber(plainRtp.rtpBytesReceived);
                // Use rtpBytesReceived as proxy for packets (estimate ~1000 bytes per packet)
                rtpPacketsReceived = Math.floor(rtpBytesReceived / 1000);
              }
            }

            // For PlainRtpTransport, producer.getStats() often shows packetsReceived=0
            // even when transport is receiving RTP data. Use transport stats when
            // producer stats show 0 packets.
            const producerPackets = inboundRtp ? toNumber(inboundRtp.packetsReceived) : 0;
            const packetsReceived = producerPackets > 0 ? producerPackets : rtpPacketsReceived;
            const producerBytes = inboundRtp ? toNumber(inboundRtp.bytesReceived) : 0;
            const bytesReceived = producerBytes > 0 ? producerBytes : rtpBytesReceived;

            response = {
              type: 'producerStats',
              producerId,
              packetsReceived,
              bytesReceived,
              ready: packetsReceived > 0,
            };
          }
          break;

        case 'getAllProducerStats':
          {
            // Get stats for all producers - used by health monitor
            // Helper to safely convert BigInt to Number
            const toNumber = (val) => typeof val === 'bigint' ? Number(val) : (val || 0);

            const allStats = [];
            for (const [producerId, producerData] of producers.entries()) {
              try {
                const stats = await producerData.producer.getStats();
                const inboundRtp = stats.find(s => s.type === 'inbound-rtp');

                // Get transport stats - for PlainRtpTransport, this is where the real
                // receive stats are (producer.getStats() returns empty for plain RTP)
                const transportData = transports.get(producerData.transportId);
                let transportStats = null;
                let rtpPacketsReceived = 0;

                if (transportData) {
                  const tStats = await transportData.transport.getStats();
                  const plainRtp = tStats.find(s => s.type === 'plain-rtp-transport');
                  if (plainRtp) {
                    const rtpBytes = toNumber(plainRtp.rtpBytesReceived);
                    transportStats = {
                      bytesReceived: toNumber(plainRtp.bytesReceived),
                      rtpBytesReceived: rtpBytes,
                      recvBitrate: toNumber(plainRtp.recvBitrate),
                    };
                    // Use rtpBytesReceived as proxy for packets (estimate ~1000 bytes per packet)
                    rtpPacketsReceived = Math.floor(rtpBytes / 1000);
                  }
                }

                // For PlainRtpTransport, producer.getStats() often shows packetsReceived=0
                // even when transport is receiving RTP data. Use transport stats when
                // producer stats show 0 packets.
                const producerPackets = inboundRtp ? toNumber(inboundRtp.packetsReceived) : 0;
                const packetsReceived = producerPackets > 0 ? producerPackets : rtpPacketsReceived;
                const producerBytes = inboundRtp ? toNumber(inboundRtp.bytesReceived) : 0;
                const bytesReceived = producerBytes > 0 ? producerBytes : toNumber(transportStats?.rtpBytesReceived);

                allStats.push({
                  producerId,
                  roomId: producerData.roomId,
                  transportId: producerData.transportId,
                  packetsReceived,
                  bytesReceived,
                  packetsLost: toNumber(inboundRtp?.packetsLost),
                  jitter: toNumber(inboundRtp?.jitter),
                  transportStats,
                });
              } catch (err) {
                console.warn(`Failed to get stats for producer ${producerId}: ${err.message}`);
                allStats.push({
                  producerId,
                  roomId: producerData.roomId,
                  error: err.message,
                });
              }
            }

            response = {
              type: 'allProducerStats',
              stats: allStats,
              timestamp: Date.now(),
            };
          }
          break;

        case 'closeProducer':
          {
            const { producerId } = payload;
            const producerData = producers.get(producerId);
            if (producerData) {
              producerData.producer.close();
              producers.delete(producerId);
              
              // Remove from room
              const room = rooms.get(producerData.roomId);
              if (room) {
                room.producerIds = room.producerIds.filter(id => id !== producerId);
              }
              
              console.log(`Producer closed: ${producerId}`);
              response = { type: 'producerClosed', status: 'success', message: `Producer ${producerId} closed` };
            } else {
              throw new Error(`Producer not found: ${producerId}`);
            }
          }
          break;
        
        case 'closeTransport':
          {
            const { transportId } = payload;
            const transportData = transports.get(transportId);
            if (transportData) {
              transportData.transport.close();
              transports.delete(transportId);

              // Remove producers on this transport
              for (const [pid, pdata] of producers.entries()) {
                if (pdata.transportId === transportId) {
                  producers.delete(pid);
                  const room = rooms.get(pdata.roomId);
                  if (room) {
                    room.producerIds = room.producerIds.filter(id => id !== pid);
                  }
                }
              }

              console.log(`Transport closed: ${transportId}`);
              response = { type: 'transportClosed', status: 'success', message: `Transport ${transportId} closed` };
            } else {
              throw new Error(`Transport not found: ${transportId}`);
            }
          }
          break;

        case 'closeTransportsForRoom':
          {
            // Close all PlainRTP transports for a room to release ports
            const { roomId } = payload;
            let closedCount = 0;

            for (const [tid, tdata] of transports.entries()) {
              if (tdata.roomId === roomId && tdata.type === 'plain') {
                try {
                  tdata.transport.close();
                  transports.delete(tid);
                  closedCount++;
                  console.log(`Closed PlainRTP transport for room ${roomId}: ${tid}`);

                  // Remove producers on this transport
                  for (const [pid, pdata] of producers.entries()) {
                    if (pdata.transportId === tid) {
                      producers.delete(pid);
                      const room = rooms.get(pdata.roomId);
                      if (room) {
                        room.producerIds = room.producerIds.filter(id => id !== pid);
                      }
                    }
                  }
                } catch (err) {
                  console.warn(`Failed to close transport ${tid}: ${err.message}`);
                }
              }
            }

            console.log(`Closed ${closedCount} PlainRTP transport(s) for room: ${roomId}`);
            response = { type: 'transportsClosedForRoom', roomId, closedCount };
          }
          break;
        
        default:
          console.warn(`Unknown message type: ${type}`);
      }
      
      ws.send(JSON.stringify(response));
      
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message,
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

/**
 * HTTP API endpoints
 */
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'MediaSoup Server',
    workers: workers.length,
    routers: routers.size,
    producers: producers.size,
  });
});

/**
 * Start server
 */
async function main() {
  console.log('Starting MediaSoup server...');
  
  await createWorkers();
  
  server.listen(config.listenPort, config.listenIp, () => {
    console.log(`\n✅ MediaSoup server running on ws://${config.listenIp}:${config.listenPort}`);
    console.log(`   Workers: ${workers.length}`);
    console.log(`   RTC ports: ${config.mediasoup.worker.rtcMinPort}-${config.mediasoup.worker.rtcMaxPort}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

