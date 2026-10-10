# Trusted media decoder

Rust 1.93.1; wasm32-unknown-unknown; locked dependencies in Cargo.lock. No WASM imports. Linker maximum linear memory 64 MiB; decoder allocations limited to 24 MiB. This is not a measured limit on whole-isolate memory.

Run `./build.sh` with the wasm32 target installed. The source and locked artifact were inherited from the isolated runtime feasibility build; normal JS builds use the checked-in artifact. Never replace this with an uploader verdict. GIF framing is additionally checked in the TypeScript wrapper. Static PNG/APNG rejection, strict JPEG, GIF and WebP full-frame decoding are intentional.

Artifact SHA-256: `2baee30e5eb88b7a59a7cc2dd70053ac35b39300ca7be99f9dee54a073bbcd91`

## Third-party attribution

- adler2 2.0.1 — 0BSD OR MIT OR Apache-2.0; https://github.com/oyvindln/adler2
- autocfg 1.5.1 — Apache-2.0 OR MIT; https://github.com/cuviper/autocfg
- bitflags 2.13.2 — MIT OR Apache-2.0; https://github.com/bitflags/bitflags
- bytemuck 1.25.2 — Zlib OR Apache-2.0 OR MIT; https://github.com/Lokathor/bytemuck
- byteorder-lite 0.1.0 — Unlicense OR MIT; https://github.com/image-rs/byteorder-lite
- cfg-if 1.0.5 — MIT OR Apache-2.0; https://github.com/rust-lang/cfg-if
- color_quant 1.1.0 — MIT; https://github.com/image-rs/color_quant.git
- crc32fast 1.5.2 — MIT OR Apache-2.0; https://github.com/srijs/rust-crc32fast
- fdeflate 0.3.7 — MIT OR Apache-2.0; https://github.com/image-rs/fdeflate
- flate2 1.1.10 — MIT OR Apache-2.0; https://github.com/rust-lang/flate2-rs
- gif 0.14.2 — MIT OR Apache-2.0; https://github.com/image-rs/image-gif
- image 0.25.10 — MIT OR Apache-2.0; https://github.com/image-rs/image
- image-webp 0.2.4 — MIT OR Apache-2.0; https://github.com/image-rs/image-webp
- miniz_oxide 0.9.1 — MIT OR Zlib OR Apache-2.0; https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide
- miniz_oxide 0.8.9 — MIT OR Zlib OR Apache-2.0; https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide
- moxcms 0.8.1 — BSD-3-Clause OR Apache-2.0; https://github.com/awxkee/moxcms.git
- num-traits 0.2.19 — MIT OR Apache-2.0; https://github.com/rust-num/num-traits
- png 0.18.1 — MIT OR Apache-2.0; https://github.com/image-rs/image-png
- pxfm 0.1.30 — BSD-3-Clause OR Apache-2.0; https://github.com/awxkee/pxfm
- quick-error 2.0.1 — MIT/Apache-2.0; http://github.com/tailhook/quick-error
- simd-adler32 0.3.10 — MIT; https://github.com/mcountryman/simd-adler32
- weezl 0.1.12 — MIT OR Apache-2.0; https://github.com/image-rs/weezl
- zlib-rs 0.6.8 — Zlib; https://github.com/trifectatechfoundation/zlib-rs
- zune-core 0.5.3 — MIT OR Apache-2.0 OR Zlib; https://github.com/etemesi254/zune-image
- zune-jpeg 0.5.15 — MIT OR Apache-2.0 OR Zlib; https://github.com/etemesi254/zune-image/tree/dev/crates/zune-jpeg
