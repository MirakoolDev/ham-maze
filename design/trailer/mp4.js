// A small MP4 writer for WebCodecs output: one H.264 video track and one AAC audio track, each stored as
// one contiguous run in the file, with the index (moov) up front so the file plays as it downloads.
// Video samples at a constant frame rate; audio in AAC frames of 1024 samples.

const enc = new TextEncoder();
function box(type, ...parts) {
  const body = concat(parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(enc.encode(type), 4); out.set(body, 8);
  return out;
}
const full = (type, version, flags, ...parts) => box(type, u8(version), u24(flags), ...parts);
function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u8 = (v) => Uint8Array.of(v & 255);
const u16 = (v) => Uint8Array.of((v >> 8) & 255, v & 255);
const u24 = (v) => Uint8Array.of((v >> 16) & 255, (v >> 8) & 255, v & 255);
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return b; };
const zeros = (n) => new Uint8Array(n);
const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
// an MPEG-4 descriptor: tag, then its length in the 4-byte form every player accepts
const desc = (tag, ...parts) => { const b = concat(parts); return concat([u8(tag), Uint8Array.of(0x80 | ((b.length >> 21) & 127), 0x80 | ((b.length >> 14) & 127), 0x80 | ((b.length >> 7) & 127), b.length & 127), b]); };

const bytes = (d) => (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d)).slice();

export function createMp4({ width, height, fps, sampleRate = 48000, channels = 2 }) {
  const video = { samples: [], key: [], avcC: null }, audio = { samples: [], asc: null };
  return {
    addVideo(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description) video.avcC = bytes(meta.decoderConfig.description);
      const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
      video.samples.push(b); if (chunk.type === 'key') video.key.push(video.samples.length);
    },
    addAudio(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description) audio.asc = bytes(meta.decoderConfig.description);
      const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); audio.samples.push(b);
    },
    finish() {
      const vTS = fps * 1000, vDur = video.samples.length * 1000; // video timescale: 1000 ticks a frame
      const aDur = audio.samples.length * 1024;
      const movieMs = Math.round(Math.max(vDur / vTS, aDur / sampleRate) * 1000);
      const hasAudio = audio.samples.length > 0 && audio.asc;
      const build = (vOff, aOff) => {
        const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(hasAudio ? 3 : 2));
        const stbl = (stsd, count, delta, sizes, off, sync) => box('stbl', stsd,
          full('stts', 0, 0, u32(1), u32(count), u32(delta)),
          ...(sync ? [full('stss', 0, 0, u32(sync.length), ...sync.map(u32))] : []),
          full('stsc', 0, 0, u32(1), u32(1), u32(count), u32(1)),
          full('stsz', 0, 0, u32(0), u32(count), ...sizes.map((s) => u32(s.length))),
          full('stco', 0, 0, u32(1), u32(off)));
        const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
        const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff), box('avcC', video.avcC));
        const vtrak = box('trak',
          full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
          box('mdia',
            full('mdhd', 0, 0, u32(0), u32(0), u32(vTS), u32(vDur), u16(0x55c4), u16(0)),
            full('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('Video\0')),
            box('minf', full('vmhd', 0, 1, zeros(8)), dinf, stbl(full('stsd', 0, 0, u32(1), avc1), video.samples.length, 1000, video.samples, vOff, video.key))));
        const traks = [vtrak];
        if (hasAudio) {
          const esds = full('esds', 0, 0, desc(3, u16(2), u8(0),
            desc(4, u8(0x40), u8(0x15), u24(0), u32(192000), u32(192000), desc(5, audio.asc)),
            desc(6, u8(2))));
          const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(channels), u16(16), u16(0), u16(0), u32(sampleRate << 16), esds);
          traks.push(box('trak',
            full('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(movieMs), zeros(8), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)),
            box('mdia',
              full('mdhd', 0, 0, u32(0), u32(0), u32(sampleRate), u32(aDur), u16(0x55c4), u16(0)),
              full('hdlr', 0, 0, u32(0), enc.encode('soun'), zeros(12), enc.encode('Sound\0')),
              box('minf', full('smhd', 0, 0, zeros(4)), dinf, stbl(full('stsd', 0, 0, u32(1), mp4a), audio.samples.length, 1024, audio.samples, aOff, null)))));
        }
        return box('moov', mvhd, ...traks);
      };
      const ftyp = box('ftyp', enc.encode('isom'), u32(0x200), enc.encode('isomiso2avc1mp41'));
      const vBytes = video.samples.reduce((n, s) => n + s.length, 0);
      const moovLen = build(0, 0).length; // offsets don't change its size
      const dataStart = ftyp.length + moovLen + 8;
      const moov = build(dataStart, dataStart + vBytes);
      const mdatLen = 8 + vBytes + (hasAudio ? audio.samples.reduce((n, s) => n + s.length, 0) : 0);
      const head = new Uint8Array(8); new DataView(head.buffer).setUint32(0, mdatLen); head.set(enc.encode('mdat'), 4);
      return new Blob([ftyp, moov, head, ...video.samples, ...(hasAudio ? audio.samples : [])], { type: 'video/mp4' });
    },
  };
}
