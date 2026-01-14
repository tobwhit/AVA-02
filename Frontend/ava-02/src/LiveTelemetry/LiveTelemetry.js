import React, { useState, useEffect, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import "./LiveTelemetry.css";
import idMap from "../idMap";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler
);

// Configuration
const WS_URL = "ws://localhost:8000/api/ws/telemetry"; // Change to AWS URL in production
const RECONNECT_INTERVAL = 3000; // 3 seconds
const MAX_DATA_POINTS = 50; // Rolling window for charts
const MAX_LOG_ENTRIES = 30; // Max telemetry feed entries

function LiveTelemetry() {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(null);

  // Telemetry data state
  const [telemetryData, setTelemetryData] = useState({});
  const [logEntries, setLogEntries] = useState([]);

  // Chart data
  const [speedData, setSpeedData] = useState([]);
  const [throttleBrakeData, setThrottleBrakeData] = useState({ throttle: [], brake: [] });
  const [batteryData, setBatteryData] = useState([]);
  const [timestamps, setTimestamps] = useState([]);

  // WebSocket reference
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Connect to WebSocket
  const connectWebSocket = () => {
    try {
      console.log("Connecting to WebSocket:", WS_URL);

      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("WebSocket Connected!");
        setConnected(true);
        addLogEntry("SYSTEM", "Connected to telemetry stream");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "connection") {
            console.log("Connection confirmed:", data.message);
          } else if (data.type === "telemetry") {
            handleTelemetryMessage(data);
          }

          setLastMessageTime(new Date());
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setConnected(false);
        addLogEntry("SYSTEM", "Disconnected from telemetry stream");

        // Attempt to reconnect
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log("Attempting to reconnect...");
          connectWebSocket();
        }, RECONNECT_INTERVAL);
      };

      wsRef.current = ws;

    } catch (err) {
      console.error("Error creating WebSocket:", err);
    }
  };

  // Disconnect from WebSocket
  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    setConnected(false);
  };

  // Handle incoming telemetry messages
  const handleTelemetryMessage = (data) => {
    const { msg_id, value, timestamp } = data;
    const sensorName = idMap[msg_id] || `Sensor ${msg_id}`;

    // Update telemetry data
    setTelemetryData(prev => ({
      ...prev,
      [msg_id]: {
        name: sensorName,
        value: value,
        timestamp: timestamp
      }
    }));

    // Update charts for specific sensors
    const now = new Date().toLocaleTimeString();

    // Speed (msg_id: varies, using a placeholder)
    if (msg_id === 192) { // Torque as placeholder for speed
      setSpeedData(prev => [...prev.slice(-MAX_DATA_POINTS + 1), value]);
      updateTimestamps();
    }

    // Throttle (msg_id: 1)
    if (msg_id === 1) {
      setThrottleBrakeData(prev => ({
        ...prev,
        throttle: [...prev.throttle.slice(-MAX_DATA_POINTS + 1), value]
      }));
      updateTimestamps();
    }

    // Brake (msg_id: 3)
    if (msg_id === 3) {
      setThrottleBrakeData(prev => ({
        ...prev,
        brake: [...prev.brake.slice(-MAX_DATA_POINTS + 1), value]
      }));
      updateTimestamps();
    }

    // Battery - calculate percentage if needed
    // Assuming battery is sent as percentage already
    // setBatteryData(prev => [...prev.slice(-MAX_DATA_POINTS + 1), batteryPercent]);

    // Add to log
    addLogEntry(sensorName, `${value}`);
  };

  // Update timestamps for chart x-axis
  const updateTimestamps = () => {
    setTimestamps(prev => {
      const newTimestamps = [...prev, new Date().toLocaleTimeString()];
      return newTimestamps.slice(-MAX_DATA_POINTS);
    });
  };

  // Add entry to telemetry feed
  const addLogEntry = (sensor, data) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogEntries(prev => [
      { timestamp, sensor, data },
      ...prev.slice(0, MAX_LOG_ENTRIES - 1)
    ]);
  };

  // Auto-connect on mount
  useEffect(() => {
    connectWebSocket();

    return () => {
      disconnectWebSocket();
    };
  }, []);

  // Helper functions
  const getSensorValue = (msgId) => {
    return telemetryData[msgId]?.value ?? 0;
  };

  // Chart configurations
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      }
    },
    scales: {
      x: {
        display: true,
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
        },
        ticks: {
          color: '#64748b',
          maxTicksLimit: 6
        }
      },
      y: {
        display: true,
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
        },
        ticks: {
          color: '#64748b'
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };

  // Speed chart data
  const speedChartData = {
    labels: timestamps,
    datasets: [
      {
        label: 'Torque',
        data: speedData,
        fill: true,
        backgroundColor: 'rgba(0, 217, 255, 0.1)',
        borderColor: '#00d9ff',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
      }
    ]
  };

  // Throttle & Brake chart data
  const throttleBrakeChartData = {
    labels: timestamps,
    datasets: [
      {
        label: 'Throttle',
        data: throttleBrakeData.throttle,
        fill: true,
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderColor: '#10b981',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
      },
      {
        label: 'Brake',
        data: throttleBrakeData.brake,
        fill: true,
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderColor: '#ef4444',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
      }
    ]
  };

  // Battery chart data
  const batteryChartData = {
    labels: timestamps,
    datasets: [
      {
        label: 'Battery',
        data: batteryData,
        fill: true,
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderColor: '#10b981',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
      }
    ]
  };

  return (
    <div className="telemetry-dashboard">
      {/* Header */}
      <header className="telemetry-header">
        <div className="header-left">
          <h1 className="telemetry-title">AVA-02 LIVE TELEMETRY</h1>
          <div className="session-info">
            <span className="session-label">LIVE SESSION</span>
            <div className={`session-status ${connected ? 'connected' : 'disconnected'}`}>
              <span className="status-indicator"></span>
              {connected ? 'CONNECTED' : 'DISCONNECTED'}
            </div>
          </div>
        </div>
        <div className="control-panel">
          {!connected ? (
            <button className="control-btn connect-btn" onClick={connectWebSocket}>
              <span>▶</span>
              <span>CONNECT</span>
            </button>
          ) : (
            <button className="control-btn disconnect-btn" onClick={disconnectWebSocket}>
              <span>⏸</span>
              <span>DISCONNECT</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Dashboard Grid */}
      <div className="telemetry-grid">
        {/* Left Panel - Primary Stats */}
        <div className="left-panel">
          <div className="stat-panel primary-stat">
            <div className="stat-header">TORQUE</div>
            <div className="stat-value-large speed-value">{getSensorValue(192)}</div>
            <div className="stat-unit">Nm</div>
          </div>

          <div className="stat-panel primary-stat">
            <div className="stat-header">THROTTLE</div>
            <div className="stat-value-large battery-value">{getSensorValue(1)}</div>
            <div className="stat-unit">raw</div>
          </div>

          <div className="secondary-stats">
            <div className="stat-panel secondary-stat">
              <div className="stat-header">THROTTLE 2</div>
              <div className="stat-value-medium">{getSensorValue(2)}</div>
              <div className="stat-unit">raw</div>
            </div>

            <div className="stat-panel secondary-stat">
              <div className="stat-header">BRAKE</div>
              <div className="stat-value-medium">{getSensorValue(3)}</div>
              <div className="stat-unit">raw</div>
            </div>
          </div>

          <div className="secondary-stats">
            <div className="stat-panel secondary-stat">
              <div className="stat-header">START SW</div>
              <div className="stat-value-medium">{getSensorValue(0)}</div>
            </div>

            <div className="stat-panel secondary-stat">
              <div className="stat-header">ERRORS</div>
              <div className="stat-value-medium">{getSensorValue(204)}</div>
            </div>
          </div>
        </div>

        {/* Center Panel - Telemetry Charts */}
        <div className="center-panel">
          <div className="chart-section">
            <div className="section-header">TORQUE</div>
            <div className="chart-wrapper">
              <Line data={speedChartData} options={chartOptions} />
            </div>
          </div>

          <div className="chart-section">
            <div className="section-header">THROTTLE & BRAKE</div>
            <div className="chart-wrapper">
              <Line data={throttleBrakeChartData} options={chartOptions} />
            </div>
          </div>

          <div className="chart-section">
            <div className="section-header">BATTERY</div>
            <div className="chart-wrapper">
              <Line data={batteryChartData} options={chartOptions} />
            </div>
          </div>
        </div>

        {/* Right Panel - Additional Stats */}
        <div className="right-panel">
          <div className="stat-panel info-stat">
            <div className="stat-header">HEALTH CHECK</div>
            <div className="stat-value-medium">{getSensorValue(200)}</div>
          </div>

          <div className="stat-panel info-stat">
            <div className="stat-header">DRIVE STATE</div>
            <div className="stat-value-medium">{getSensorValue(205)}</div>
          </div>

          <div className="stat-panel info-stat">
            <div className="stat-header">ACCEL X</div>
            <div className="stat-value-medium">{getSensorValue(400)}</div>
            <div className="stat-unit">m/s²</div>
          </div>

          <div className="stat-panel info-stat">
            <div className="stat-header">ACCEL Y</div>
            <div className="stat-value-medium">{getSensorValue(401)}</div>
            <div className="stat-unit">m/s²</div>
          </div>

          <div className="stat-panel info-stat">
            <div className="stat-header">ACCEL Z</div>
            <div className="stat-value-medium">{getSensorValue(402)}</div>
            <div className="stat-unit">m/s²</div>
          </div>

          {/* Telemetry Feed */}
          <div className="telemetry-feed">
            <div className="section-header">TELEMETRY FEED</div>
            <div className="feed-content">
              {logEntries.map((entry, index) => (
                <div key={index} className="log-entry">
                  <span className="log-time">{entry.timestamp}</span>
                  <span className="log-data">
                    <span className="log-sensor-name">{entry.sensor}</span>: {entry.data}
                  </span>
                </div>
              ))}
              {logEntries.length === 0 && (
                <div className="log-entry">
                  <span className="log-data">Waiting for telemetry data...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LiveTelemetry;
