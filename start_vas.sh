#!/bin/bash

# Video Aggregation Service - Startup Script

echo "Starting VAS services..."
echo "================================"

# Set backend IP
BACKEND_IP=${BACKEND_IP:-"10.30.250.99"}
BACKEND_PORT=${BACKEND_PORT:-"8085"}

# Start Backend
echo "Starting Backend on ${BACKEND_IP}:${BACKEND_PORT}..."
cd backend
pkill -f "uvicorn main:app" 2>/dev/null
nohup python3 -m uvicorn main:app --host 0.0.0.0 --port ${BACKEND_PORT} > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to start
sleep 3
if curl -s http://localhost:${BACKEND_PORT}/health > /dev/null; then
    echo "✓ Backend is running"
else
    echo "✗ Backend failed to start"
    exit 1
fi

# Start Frontend
echo "Starting Frontend..."
cd ../frontend
pkill -f "next dev" 2>/dev/null
NEXT_PUBLIC_API_URL=http://${BACKEND_IP}:${BACKEND_PORT} npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# Wait for frontend to start
sleep 5
if curl -s http://localhost:3000 > /dev/null; then
    echo "✓ Frontend is running"
else
    echo "✗ Frontend failed to start"
    exit 1
fi

echo "================================"
echo "Services started successfully!"
echo ""
echo "Frontend: http://${BACKEND_IP}:3000"
echo "Backend:  http://${BACKEND_IP}:${BACKEND_PORT}"
echo "API Docs: http://${BACKEND_IP}:${BACKEND_PORT}/docs"
echo ""
echo "To view logs:"
echo "  Backend:  tail -f /tmp/backend.log"
echo "  Frontend: tail -f /tmp/frontend.log"
echo ""
echo "To stop services:"
echo "  kill $BACKEND_PID $FRONTEND_PID"


