# Our live telemetry WebSocket endpoint, based off of telemetry.py (the one from Claude)
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List, Dict
import logging
from datetime import datetime

router = APIRouter()