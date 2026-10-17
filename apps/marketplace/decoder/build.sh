#!/usr/bin/env sh
set -eu
# Install the wasm32 target into a task-local toolchain if it is not already available.
# Override CARGO_HOME/RUSTUP_HOME/RUSTFLAGS to keep shared developer toolchains untouched.
cd "$(dirname "$0")"
RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=--max-memory=67108864" cargo +1.93.1 build --locked --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/amoji_decoder_probe.wasm ../src/decoder.wasm
