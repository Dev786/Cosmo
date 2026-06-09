// Encode 16kHz mono Float32 PCM (the format main accumulates a turn in) into a
// standard 16-bit PCM WAV Buffer. Cloud STT vendors want an uploadable audio file;
// the local worker takes Float32 directly, so this is only used on the cloud path.
// (Inverse of pcm16ToFloat32 in transformersWhisper.)
export function float32ToWav16(pcm: Float32Array, sampleRate = 16000): Buffer {
  const numSamples = pcm.length;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);            // PCM fmt chunk size
  buf.writeUInt16LE(1, 20);             // audio format 1 = PCM
  buf.writeUInt16LE(1, 22);             // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * blockAlign)
  buf.writeUInt16LE(2, 32);             // block align (channels * bytesPerSample)
  buf.writeUInt16LE(16, 34);            // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let o = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, o);
    o += 2;
  }
  return buf;
}
