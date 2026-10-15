#!/usr/bin/env bash
# Install system dependencies for OpenCV/MediaPipe
apt-get update && apt-get install -y libgl1 libglib2.0-0

# Install Python dependencies
pip install -r backend/requirements.txt