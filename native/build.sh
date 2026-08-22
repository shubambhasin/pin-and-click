#!/bin/sh
# Rebuild the native clicker. Needs Xcode Command Line Tools (xcode-select --install).
set -e
cd "$(dirname "$0")"
swiftc -O -framework CoreGraphics -framework ApplicationServices -o nativeclick nativeclick.swift
echo "✓ built ./nativeclick"
