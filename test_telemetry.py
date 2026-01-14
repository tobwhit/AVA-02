#!/usr/bin/env python3
"""
Test script to simulate live telemetry data
Run this to test your WebSocket setup without needing the Raspberry Pi
"""

import requests
import time
import random
import json

# Configuration
SERVER_URL = "http://localhost:8000/api/telemetry/send"
BATCH_URL = "http://localhost:8000/api/telemetry/batch"

def send_single_reading(msg_id, value):
    """Send a single sensor reading"""
    try:
        data = {
            "msg_id": msg_id,
            "value": value,
            "timestamp": int(time.time() * 1000)
        }

        response = requests.post(SERVER_URL, json=data, timeout=2)

        if response.status_code == 200:
            result = response.json()
            print(f"✓ Sent {msg_id}={value} → {result['broadcasted_to']} clients")
            return True
        else:
            print(f"✗ Error: {response.status_code}")
            return False

    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def send_batch_readings(readings):
    """Send batch of readings"""
    try:
        data = {
            "readings": readings,
            "timestamp": int(time.time() * 1000)
        }

        response = requests.post(BATCH_URL, json=data, timeout=2)

        if response.status_code == 200:
            result = response.json()
            print(f"✓ Batch: {len(readings)} readings → {result['broadcasted_to']} clients")
            return True
        else:
            print(f"✗ Error: {response.status_code}")
            return False

    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def simulate_realistic_driving():
    """Simulate realistic driving telemetry"""
    print("\n🏎️  Simulating realistic driving data...")
    print("Press Ctrl+C to stop\n")

    # Initial values
    throttle1 = 0
    throttle2 = 0
    brake = 0
    torque = 0
    speed = 0

    try:
        while True:
            # Simulate acceleration/deceleration
            action = random.choice(['accelerate', 'coast', 'brake'])

            if action == 'accelerate':
                throttle1 = min(1023, throttle1 + random.randint(10, 50))
                throttle2 = throttle1 + random.randint(-10, 10)
                brake = max(0, brake - random.randint(0, 20))
                torque = min(2000, torque + random.randint(50, 200))
            elif action == 'brake':
                throttle1 = max(0, throttle1 - random.randint(20, 100))
                throttle2 = throttle1 + random.randint(-10, 10)
                brake = min(1023, brake + random.randint(50, 200))
                torque = max(0, torque - random.randint(100, 300))
            else:  # coast
                throttle1 = max(0, throttle1 - random.randint(0, 20))
                throttle2 = throttle1 + random.randint(-5, 5)
                brake = max(0, brake - random.randint(0, 10))
                torque = max(0, torque - random.randint(0, 50))

            # Keep values in valid ranges
            throttle1 = max(0, min(1023, throttle1))
            throttle2 = max(0, min(1023, throttle2))
            brake = max(0, min(1023, brake))
            torque = max(0, min(2000, torque))

            # Send batch
            readings = [
                {"msg_id": 1, "value": throttle1},   # Throttle 1
                {"msg_id": 2, "value": throttle2},   # Throttle 2
                {"msg_id": 3, "value": brake},       # Brake
                {"msg_id": 192, "value": torque},    # Torque
            ]

            send_batch_readings(readings)

            # Update every 100ms
            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n\n✓ Simulation stopped")

def test_all_sensors():
    """Test all sensor IDs from idMap"""
    print("\n🧪 Testing all sensor types...\n")

    sensor_tests = [
        (0, "Start Switch", 1),
        (1, "Throttle 1", 512),
        (2, "Throttle 2", 510),
        (3, "Brake", 256),
        (9, "GPS", 12345),  # GPS will need special handling
        (192, "Torque", 1500),
        (200, "Health Check", 1),
        (204, "Errors", 0),
        (205, "Drive State", 2),
        (400, "Accelerometer X", 100),
        (401, "Accelerometer Y", -50),
        (402, "Accelerometer Z", 980),
        (500, "Hotbox Temp 1", 2500),
        (501, "Hotbox Temp 2", 2450),
        (502, "Hotbox Temp 3", 2480),
    ]

    for msg_id, name, value in sensor_tests:
        print(f"Testing {name} (ID {msg_id})...")
        send_single_reading(msg_id, value)
        time.sleep(0.5)

    print("\n✓ All sensors tested!")

def stress_test():
    """Send rapid data to test system capacity"""
    print("\n⚡ Running stress test...")
    print("Sending 1000 readings as fast as possible...\n")

    start_time = time.time()
    success_count = 0

    for i in range(1000):
        if send_single_reading(1, random.randint(0, 1023)):
            success_count += 1

    elapsed = time.time() - start_time
    rate = success_count / elapsed

    print(f"\n✓ Stress test complete!")
    print(f"  Sent: {success_count}/1000 readings")
    print(f"  Time: {elapsed:.2f} seconds")
    print(f"  Rate: {rate:.2f} readings/second")

def main():
    """Main menu"""
    print("=" * 50)
    print("AVA-02 Telemetry Test Script")
    print("=" * 50)
    print("\nMake sure your backend is running!")
    print("Backend: http://localhost:8000/api")
    print("Frontend: http://localhost:3000/live-telemetry")
    print("\nOptions:")
    print("1. Simulate realistic driving (continuous)")
    print("2. Test all sensor types (one-time)")
    print("3. Stress test (1000 readings)")
    print("4. Send custom value")
    print("5. Exit")

    while True:
        try:
            choice = input("\nEnter choice (1-5): ").strip()

            if choice == "1":
                simulate_realistic_driving()
            elif choice == "2":
                test_all_sensors()
            elif choice == "3":
                stress_test()
            elif choice == "4":
                msg_id = int(input("Enter sensor ID: "))
                value = int(input("Enter value: "))
                send_single_reading(msg_id, value)
            elif choice == "5":
                print("\n👋 Goodbye!")
                break
            else:
                print("Invalid choice. Try again.")

        except KeyboardInterrupt:
            print("\n\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"\n✗ Error: {e}")

if __name__ == "__main__":
    main()
