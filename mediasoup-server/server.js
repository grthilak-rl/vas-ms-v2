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
      rtcMinPort: 40000,
      rtcMaxPort: 40999,
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
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '10.30.250.245', // Server's public IP
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
 * Create PlainRtpTransport for FFmpeg input
 */
async function createPlainRtpTransport(roomId) {
  const router = await createRouter(roomId);
  
  const transport = await router.createPlainTransport({
    ...config.mediasoup.plainRtpTransport,
    comedia: true, // Auto-detect remote IP and accept RTP from any source
  });
  
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
  
  // Listen for trace events
  producer.on('trace', (trace) => {
    if (trace.type === 'keyframe' || trace.type === 'probation' || trace.type === 'rtp') {
      console.log(`[TRACE] Producer ${producer.id}:`, JSON.stringify(trace, null, 2));
    }
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
        console.log(`✅ Inbound RTP found:`);
        console.log(`   packetsReceived: ${inboundRtp.packetsReceived || 0}`);
        console.log(`   bytesReceived: ${inboundRtp.bytesReceived || 0}`);
        console.log(`   ssrc: ${inboundRtp.ssrc || 'N/A'}`);
        console.log(`   expected ssrc: ${rtpParameters.encodings?.[0]?.ssrc || 'N/A'}`);
        
        if (inboundRtp.ssrc) {
          const expectedSsrc = rtpParameters.encodings?.[0]?.ssrc;
          if (expectedSsrc && inboundRtp.ssrc !== expectedSsrc) {
            console.warn(`⚠️  SSRC MISMATCH! Expected ${expectedSsrc}, got ${inboundRtp.ssrc}`);
          } else if (expectedSsrc) {
            console.log(`✅ SSRC matches: ${inboundRtp.ssrc}`);
          }
        }
        
        if ((inboundRtp.packetsReceived || 0) === 0) {
          console.warn(`⚠️  WARNING: No packets received despite FFmpeg running!`);
        } else {
          console.log(`✅ Producer IS receiving packets (${inboundRtp.packetsReceived} packets)`);
        }
      } else {
        console.warn(`⚠️  No inbound-rtp stats found! Producer may not be receiving packets.`);
        console.log(`Full transport stats:`, JSON.stringify(transportStats, null, 2));
        console.log(`Full producer stats:`, JSON.stringify(producerStats, null, 2));
        
        // Check transport tuple to verify remote endpoint
        const plainRtpStat = transportStats.find(s => s.type === 'plain-rtp-transport');
        if (plainRtpStat && plainRtpStat.tuple) {
          console.log(`Transport tuple: local=${plainRtpStat.tuple.localIp}:${plainRtpStat.tuple.localPort}, remote=${plainRtpStat.tuple.remoteIp}:${plainRtpStat.tuple.remotePort}`);
          if (!plainRtpStat.tuple.remoteIp || plainRtpStat.tuple.remoteIp === '0.0.0.0') {
            console.warn(`⚠️  Transport tuple not set - comedia may not have detected remote endpoint yet`);
          }
        }
      }
      
      if (transportStat) {
        console.log(`Transport stats:`, JSON.stringify(transportStat, null, 2));
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
            const { roomId } = payload;
            const transportInfo = await createPlainRtpTransport(roomId);
            response = {
              type: 'plainRtpTransportCreated',
              transportInfo,
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

