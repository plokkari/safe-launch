#!/usr/bin/env bash
set -euo pipefail

# Rust
curl https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"
rustup install 1.79.0
rustup toolchain install 1.77.0

# Solana 1.18.26
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version

# Anchor 0.31.1 (via avm)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
~/.cargo/bin/avm install 0.31.1
~/.cargo/bin/avm use 0.31.1
anchor --version

# One-time: ensure v3 lockfile compatibility
cd /workspaces/$(basename "$GITHUB_REPOSITORY")/contracts/cap_guard || true
find . -name Cargo.lock -delete || true
cargo +1.77.0 generate-lockfile || true

echo "✅ Devcontainer setup complete."
