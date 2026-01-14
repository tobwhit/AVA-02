# AVA-02 Live Telemetry - Complete Setup Guide

This guide walks you through setting up the complete live telemetry system from Raspberry Pi → AWS → Web Dashboard.

## ✅ What's Already Done

- ✅ Backend WebSocket endpoint created (`Backend/endpoints/telemetry.py`)
- ✅ Frontend LiveTelemetry component updated with WebSocket client
- ✅ Connection management and auto-reconnection implemented
- ✅ Real-time sensor display with Material-UI cards

---

## 📋 Table of Contents

1. [Test Locally First](#1-test-locally-first)
2. [Raspberry Pi Setup](#2-raspberry-pi-setup)
3. [AWS Deployment](#3-aws-deployment)
4. [Testing & Debugging](#4-testing--debugging)
5. [Production Configuration](#5-production-configuration)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Test Locally First

Before deploying to AWS, test everything on your local network.

### 1.1 Start the Backend

```bash
cd "/Users/rental/Library/CloudStorage/OneDrive-BrighamYoungUniversity/Ava-02/AVA-02/Backend"
source venv/bin/activate
uvicorn main:app --reload --reload-exclude='venv/*' --host 0.0.0.0 --port 8000
```

### 1.2 Start the Frontend

Open a new terminal:

```bash
cd "/Users/rental/Library/CloudStorage/OneDrive-BrighamYoungUniversity/Ava-02/AVA-02/Frontend/ava-02"
npm start
```

### 1.3 Test WebSocket Connection

1. Open http://localhost:3000
2. Click "Live Telemetry" in the navigation
3. You should see "Connected" with a green dot

### 1.4 Send Test Data

Open a new terminal and test sending data:

```bash
curl -X POST http://localhost:8000/api/telemetry/send \
  -H "Content-Type: application/json" \
  -d '{
    "msg_id": 1,
    "value": 512,
    "timestamp": 1674567890123
  }'
```

You should see the "Throttle 1" card update to 512 in the browser!

### 1.5 Test Batch Sending

```bash
curl -X POST http://localhost:8000/api/telemetry/batch \
  -H "Content-Type: application/json" \
  -d '{
    "readings": [
      {"msg_id": 1, "value": 512},
      {"msg_id": 2, "value": 256},
      {"msg_id": 3, "value": 128},
      {"msg_id": 192, "value": 1024}
    ],
    "timestamp": 1674567890123
  }'
```

All four cards should update simultaneously!

---

## 2. Raspberry Pi Setup

### 2.1 Install Required Software on Pi

SSH into your Raspberry Pi:

```bash
ssh pi@raspberrypi.local
```

Install dependencies:

```bash
# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Python 3 and pip
sudo apt-get install python3 python3-pip -y

# Install required Python packages
pip3 install requests pyserial
```

### 2.2 Create the Telemetry Sender Script

Create a new file on the Pi:

```bash
nano ~/telemetry_sender.py
```

Paste this code:

```python
#!/usr/bin/env python3
"""
AVA-02 Telemetry Sender
Reads sensor data from CAN bus and sends to AWS server via HTTP
"""

import requests
import time
import serial
import json
from datetime import datetime

# Configuration
SERVER_URL = "http://localhost:8000/api/telemetry/send"  # Change to AWS URL
BATCH_URL = "http://localhost:8000/api/telemetry/batch"  # Change to AWS URL
SERIAL_PORT = "/dev/ttyUSB0"  # Your serial port
BAUD_RATE = 9600
BATCH_SIZE = 10  # Send every 10 readings
BATCH_INTERVAL = 0.1  # Or every 0.1 seconds

# Global variables
batch_buffer = []
last_send_time = time.time()

def parse_can_message(line):
    """
    Parse CAN message in format: "MSG_ID HEX_HIGH HEX_LOW"
    Returns: (msg_id, value)
    """
    try:
        parts = line.strip().split()
        if len(parts) < 3:
            return None

        msg_id = int(parts[0])
        high_byte = int(parts[1], 16)
        low_byte = int(parts[2], 16)

        # Combine bytes into 16-bit value
        value = (low_byte << 8) | high_byte

        # Handle signed 16-bit (if needed)
        if value > 32767:
            value = value - 65536

        return msg_id, value
    except Exception as e:
        print(f"Error parsing message: {e}")
        return None

def send_single(msg_id, value):
    """Send single sensor reading to server"""
    try:
        data = {
            "msg_id": msg_id,
            "value": value,
            "timestamp": int(time.time() * 1000)
        }

        response = requests.post(SERVER_URL, json=data, timeout=2)

        if response.status_code == 200:
            result = response.json()
            print(f"Sent: {msg_id}={value} -> {result['broadcasted_to']} clients")
            return True
        else:
            print(f"Error: {response.status_code}")
            return False

    except requests.exceptions.Timeout:
        print("Timeout sending data")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False

def send_batch(readings):
    """Send batch of sensor readings"""
    try:
        data = {
            "readings": readings,
            "timestamp": int(time.time() * 1000)
        }

        response = requests.post(BATCH_URL, json=data, timeout=2)

        if response.status_code == 200:
            result = response.json()
            print(f"Batch sent: {len(readings)} readings -> {result['broadcasted_to']} clients")
            return True
        else:
            print(f"Error: {response.status_code}")
            return False

    except Exception as e:
        print(f"Error: {e}")
        return False

def add_to_batch(msg_id, value):
    """Add reading to batch buffer and send if threshold reached"""
    global batch_buffer, last_send_time

    batch_buffer.append({"msg_id": msg_id, "value": value})

    # Send if batch is full or time elapsed
    if len(batch_buffer) >= BATCH_SIZE or (time.time() - last_send_time) > BATCH_INTERVAL:
        if batch_buffer:
            send_batch(batch_buffer)
            batch_buffer = []
            last_send_time = time.time()

def read_serial_and_send():
    """Main loop: read from serial and send to server"""
    print(f"Opening serial port {SERIAL_PORT} at {BAUD_RATE} baud...")

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print("Serial port opened successfully!")
        print(f"Sending data to: {SERVER_URL}")

        message_buffer = ""

        while True:
            try:
                # Read from serial
                if ser.in_waiting > 0:
                    chunk = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                    message_buffer += chunk

                    # Look for complete messages (delimited by *& and &*)
                    while True:
                        start_idx = message_buffer.find("*&")
                        end_idx = message_buffer.find("&*")

                        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                            # Extract message
                            message = message_buffer[start_idx + 2:end_idx]
                            message_buffer = message_buffer[end_idx + 2:]

                            # Parse and send
                            result = parse_can_message(message)
                            if result:
                                msg_id, value = result

                                # Choose sending method:
                                # Option 1: Send immediately
                                # send_single(msg_id, value)

                                # Option 2: Use batching (recommended)
                                add_to_batch(msg_id, value)
                        else:
                            break

                # Small delay
                time.sleep(0.001)

            except KeyboardInterrupt:
                print("\nStopping...")
                break
            except Exception as e:
                print(f"Error in loop: {e}")
                time.sleep(1)

    except serial.SerialException as e:
        print(f"Serial port error: {e}")
        print("Make sure the device is connected and you have permissions.")
        print("Try: sudo usermod -a -G dialout $USER")
    except Exception as e:
        print(f"Unexpected error: {e}")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()
            print("Serial port closed.")

if __name__ == "__main__":
    print("AVA-02 Telemetry Sender Starting...")
    print(f"Timestamp: {datetime.now()}")
    read_serial_and_send()
```

Make it executable:

```bash
chmod +x ~/telemetry_sender.py
```

### 2.3 Configure Serial Port Permissions

```bash
# Add user to dialout group for serial access
sudo usermod -a -G dialout $USER

# List available serial ports
ls -l /dev/tty*

# Find your device (usually /dev/ttyUSB0 or /dev/ttyACM0)
```

### 2.4 Test the Script Locally

First, test with your local development server:

```bash
# Edit the script to use your computer's IP
nano ~/telemetry_sender.py

# Change this line:
# SERVER_URL = "http://192.168.1.X:8000/api/telemetry/send"
# (Replace X with your computer's local IP)

# Run the script
python3 ~/telemetry_sender.py
```

### 2.5 Create Systemd Service (Auto-start on boot)

Create a service file:

```bash
sudo nano /etc/systemd/system/telemetry.service
```

Paste this:

```ini
[Unit]
Description=AVA-02 Telemetry Sender
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi
ExecStart=/usr/bin/python3 /home/pi/telemetry_sender.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable telemetry.service
sudo systemctl start telemetry.service

# Check status
sudo systemctl status telemetry.service

# View logs
sudo journalctl -u telemetry.service -f
```

---

## 3. AWS Deployment

### 3.1 Choose AWS Setup

**Option A: EC2 with Application Load Balancer (Recommended)**
- More control
- Easier to debug
- Supports WebSockets natively

**Option B: API Gateway + Lambda (Serverless)**
- Auto-scaling
- More complex setup
- Requires DynamoDB for connection tracking

We'll use **Option A (EC2 + ALB)** for this guide.

### 3.2 Launch EC2 Instance

1. Go to AWS Console → EC2
2. Click "Launch Instance"
3. Choose:
   - **AMI**: Ubuntu Server 22.04 LTS
   - **Instance Type**: t3.small (or larger for production)
   - **Security Group**: Create new with rules:
     - SSH (22) from your IP
     - HTTP (80) from 0.0.0.0/0
     - HTTPS (443) from 0.0.0.0/0
     - Custom TCP (8000) from 0.0.0.0/0 (temporary for testing)

### 3.3 Install Backend on EC2

SSH into your EC2 instance:

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

Install dependencies:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and PostgreSQL
sudo apt install python3 python3-pip python3-venv postgresql postgresql-contrib -y

# Install Nginx (for reverse proxy)
sudo apt install nginx -y
```

Set up PostgreSQL:

```bash
sudo -u postgres psql

# In PostgreSQL:
CREATE USER evangelion WITH PASSWORD 'your-secure-password';
CREATE DATABASE ava02_production;
GRANT ALL PRIVILEGES ON DATABASE ava02_production TO evangelion;
\q
```

Upload your backend code:

```bash
# On your local machine:
cd AVA-02/Backend
tar -czf backend.tar.gz *.py endpoints/ --exclude=venv --exclude=__pycache__

scp -i your-key.pem backend.tar.gz ubuntu@your-ec2-ip:~/

# On EC2:
mkdir -p ~/ava02-backend
cd ~/ava02-backend
tar -xzf ~/backend.tar.gz

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install fastapi uvicorn sqlalchemy psycopg2-binary pydantic pandas
```

Update `configDB.py` with production credentials:

```bash
nano ~/ava02-backend/configDB.py
```

```python
DATABASE_URL = "postgresql://evangelion:your-secure-password@localhost/ava02_production"
```

Load your database dump:

```bash
# Transfer dump file
scp -i your-key.pem Backend/2025_dump.sql ubuntu@your-ec2-ip:~/

# Load into PostgreSQL
psql -U evangelion -d ava02_production -f ~/2025_dump.sql
```

### 3.4 Create Systemd Service for FastAPI

```bash
sudo nano /etc/systemd/system/ava02-backend.service
```

```ini
[Unit]
Description=AVA-02 FastAPI Backend
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/ava02-backend
Environment="PATH=/home/ubuntu/ava02-backend/venv/bin"
ExecStart=/home/ubuntu/ava02-backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ava02-backend.service
sudo systemctl start ava02-backend.service
sudo systemctl status ava02-backend.service
```

### 3.5 Configure Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/ava02
```

```nginx
upstream backend {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain

    location /api/ {
        proxy_pass http://backend/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket specific
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/ava02 /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 3.6 Set Up HTTPS with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

Follow prompts to get SSL certificate.

### 3.7 Deploy Frontend

**Option 1: Build and serve with Nginx**

On your local machine:

```bash
cd Frontend/ava-02

# Update WebSocket URL in LiveTelemetry.js
nano src/LiveTelemetry/LiveTelemetry.js

# Change line 14 to:
const WS_URL = "wss://your-domain.com/api/ws/telemetry";

# Build
npm run build

# Create tarball
tar -czf build.tar.gz build/

# Upload to EC2
scp -i your-key.pem build.tar.gz ubuntu@your-ec2-ip:~/
```

On EC2:

```bash
sudo mkdir -p /var/www/ava02
sudo tar -xzf ~/build.tar.gz -C /var/www/ava02 --strip-components=1
sudo chown -R www-data:www-data /var/www/ava02
```

Update Nginx config:

```bash
sudo nano /etc/nginx/sites-available/ava02
```

Add this above the `location /api/` block:

```nginx
    root /var/www/ava02;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
```

Restart Nginx:

```bash
sudo systemctl restart nginx
```

**Option 2: Use Vercel/Netlify (Easier)**

Just update the WebSocket URL and deploy to Vercel:

```bash
cd Frontend/ava-02
vercel --prod
```

### 3.8 Configure Security Group for Raspberry Pi

In AWS Console:

1. Go to EC2 → Security Groups
2. Find your instance's security group
3. Add inbound rule:
   - Type: Custom TCP
   - Port: 8000 (or 443 if using HTTPS)
   - Source: Your Pi's IP or 0.0.0.0/0

---

## 4. Testing & Debugging

### 4.1 Test from Raspberry Pi

Update the Pi script:

```bash
nano ~/telemetry_sender.py

# Change SERVER_URL to:
SERVER_URL = "https://your-domain.com/api/telemetry/send"
BATCH_URL = "https://your-domain.com/api/telemetry/batch"
```

Test:

```bash
python3 ~/telemetry_sender.py
```

### 4.2 Monitor Backend Logs

On EC2:

```bash
# Backend logs
sudo journalctl -u ava02-backend.service -f

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### 4.3 Test WebSocket Connection

```bash
# Install wscat
npm install -g wscat

# Test WebSocket
wscat -c wss://your-domain.com/api/ws/telemetry
```

### 4.4 Send Test Data

```bash
curl -X POST https://your-domain.com/api/telemetry/send \
  -H "Content-Type: application/json" \
  -d '{"msg_id": 1, "value": 999}'
```

---

## 5. Production Configuration

### 5.1 Environment Variables

Create `.env` file on EC2:

```bash
nano ~/ava02-backend/.env
```

```bash
DATABASE_URL=postgresql://evangelion:password@localhost/ava02_production
SECRET_KEY=your-secret-key-here
ENVIRONMENT=production
```

Update `configDB.py`:

```python
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://evangelion:password@localhost/postgres")
```

### 5.2 Enable Connection Limits

In `telemetry.py`, add max connections:

```python
class ConnectionManager:
    def __init__(self, max_connections=100):
        self.active_connections: List[WebSocket] = []
        self.max_connections = max_connections

    async def connect(self, websocket: WebSocket):
        if len(self.active_connections) >= self.max_connections:
            await websocket.close(code=1008, reason="Server at capacity")
            return False
        # ... rest of code
```

### 5.3 Add Rate Limiting

Install:

```bash
pip install slowapi
```

Update `main.py`:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# In telemetry.py:
@router.post("/telemetry/send")
@limiter.limit("100/minute")  # Max 100 requests per minute
async def receive_telemetry_data(request: Request, data: Dict):
    # ... existing code
```

---

## 6. Troubleshooting

### Issue: WebSocket won't connect

**Check:**
- Is backend running? `sudo systemctl status ava02-backend`
- Is Nginx running? `sudo systemctl status nginx`
- Check Nginx error logs: `sudo tail -f /var/log/nginx/error.log`
- Firewall rules allowing port 443?

**Test:**
```bash
curl https://your-domain.com/api/telemetry/status
```

### Issue: Pi can't reach server

**Check:**
- Can Pi ping the server? `ping your-domain.com`
- Is SERVER_URL correct in telemetry_sender.py?
- Check Pi logs: `sudo journalctl -u telemetry.service -f`

**Test:**
```bash
# On Pi:
curl -X POST https://your-domain.com/api/telemetry/send \
  -H "Content-Type: application/json" \
  -d '{"msg_id": 1, "value": 123}'
```

### Issue: Data not appearing on frontend

**Check:**
- Open browser console (F12) for errors
- Is WebSocket connected? Look for green dot
- Check Network tab for WebSocket messages

### Issue: High latency

**Solutions:**
- Use batch sending instead of individual messages
- Increase BATCH_SIZE in Pi script
- Check network quality: `ping -c 100 your-domain.com`

---

## 📚 Additional Resources

- FastAPI WebSockets: https://fastapi.tiangolo.com/advanced/websockets/
- Nginx WebSocket proxying: https://nginx.org/en/docs/http/websocket.html
- AWS EC2 tutorials: https://docs.aws.amazon.com/ec2/

---

## 🎉 Next Steps

Once everything is working:

1. Add data recording to database during live sessions
2. Implement alerts for threshold violations
3. Add historical playback feature
4. Create mobile-responsive dashboard
5. Add multiple driver/car support
6. Implement authentication for security

Good luck with your live telemetry system! 🏎️💨
