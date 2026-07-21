# Use a unified Python & Node base image
FROM python:3.14-slim AS base

# Install Node.js and system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCV and system GUI dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Python virtual environment & dependencies
COPY dxferpy/requirements.txt ./dxferpy/requirements.txt
RUN python3 -m venv dxferpy/venv \
    && dxferpy/venv/bin/pip install --upgrade pip \
    && dxferpy/venv/bin/pip install -r dxferpy/requirements.txt

# Setup Frontend Node dependencies
COPY web/package*.json ./web/
RUN cd web && npm ci

# Copy the rest of the project
COPY . .

# Build the Frontend static assets
RUN cd web && npm run build

EXPOSE 8787

# Command to start the application (starts Node.js API which automatically spawns Python worker)
CMD ["npm", "start", "--prefix", "web"]
