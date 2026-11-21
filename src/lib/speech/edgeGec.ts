/**
 * Port fiel (BigInt) do gerador de token `Sec-MS-GEC` v2 do serviço de TTS do Edge.
 * Reimplementa exatamente o algoritmo ofuscado do edge-tts (CS64 + SHA-256 com
 * constantes derivadas). Validado contra a implementação de referência
 * (edge-tts 7.3.1) — ver tests/video.test.ts.
 */

const WIN_EPOCH = 11_644_473_600 // segundos entre 1601-01-01 e 1970-01-01
const TICKS_PER_SECOND = 1e7 // ticks de 100 ns por segundo
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const U32 = 0xffffffffn

const u32 = (n: bigint) => n & U32
const U = (xs: number[]) => xs.map(x => BigInt(x))

// ─── SHA-256 ofuscado (constantes derivadas) ─────────────────────────────────

const SHA256_INITIAL = U([
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
])

const SHA256_STATE = U([
  0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
  0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
])

const SHA256_SCHEDULE = U([
  0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
  0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
  0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
  0xD258B060, 0x72766564,
])

const SHA256_ROUND_CONSTANTS = U([
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
])

const SHA256_ADJUSTMENT = 0xC9DC06A7n
const SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80n
const SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0n

const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
]

// ─── CS64 ─────────────────────────────────────────────────────────────────────

const CS64_COEFFICIENTS: Array<[number, number]> = [
  [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167],
]

const CS64_FACTOR = 0x82893933n
const CS64_ADJUSTMENT0 = 0xF2F90B1An
const CS64_ADJUSTMENT1 = 0x0B1A0000n

// ─── Primitivas ───────────────────────────────────────────────────────────────

const rol16 = (value: bigint): bigint => {
  value &= U32
  return ((value << 16n) | (value >> 16n)) & U32
}

/** Palavras LE de 32 bits; o total é arredondado para PAR acrescentando um zero. */
function wordsLE4Even(data: Buffer): bigint[] {
  if (!data.length) return []
  const words: bigint[] = []
  for (let i = 0; i + 4 <= data.length; i += 4) words.push(BigInt(data.readUInt32LE(i)))
  const rem = data.length % 4
  if (rem) {
    let w = 0n
    for (let i = data.length - rem, shift = 0n; i < data.length; i++, shift += 8n) w |= BigInt(data[i]) << shift
    words.push(w)
  }
  if (words.length % 2) words.push(0n)
  return words
}

const sigma0 = (v: bigint) => (v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ ((v >> 3n) & U32)
const sigma1 = (v: bigint) => (v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ ((v >> 10n) & U32)
const sigma0Raw = (v: bigint) => (v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)
const sigma1Raw = (v: bigint) => (v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)

function expandSha256Schedule(words: bigint[], firstWord = 16): void {
  for (let index = firstWord; index < 64; index++) {
    const x = words[index - 2]
    const y = words[index - 15]
    words.push(u32(sigma1Raw(x) + words[index - 7] + sigma0Raw(y) + words[index - 16]))
  }
}

/** Núcleo das 64 rodadas: parte inicial em forma canônica, depois o desenrolamento literal do original. */
function sha256Rounds(state: bigint[], words: bigint[], firstRound = 0): bigint[] {
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7]
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS
  const aligned = Math.min(64, Math.floor((firstRound + 7) / 8) * 8)
  for (let index = firstRound; index < aligned; index++) {
    const rotE = e * 0x100000001n
    const rotA = a * 0x100000001n
    const t1 = h + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (g ^ (e & (f ^ g))) + constants[index] + words[index]
    const t2 = ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((a & b) | (c & (a | b)))
    const na = u32(t1 + t2)
    const nd = u32(d + t1)
    h = g; g = f; f = e; e = nd; d = c; c = b; b = a; a = na
  }
  // Parte desenrolada: janela de registros rotacionada de 2 posições a cada rodada
  for (let index = aligned; index < 64; index += 8) {
    let rotE = e * 0x100000001n, rotA = a * 0x100000001n
    let t1 = h + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (g ^ (e & (f ^ g))) + constants[index] + words[index]
    d = u32(d + t1)
    h = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((a & b) | (c & (a | b))))
    rotE = d * 0x100000001n; rotA = h * 0x100000001n
    t1 = g + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (f ^ (d & (e ^ f))) + constants[index + 1] + words[index + 1]
    c = u32(c + t1)
    g = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((h & a) | (b & (h | a))))
    rotE = c * 0x100000001n; rotA = g * 0x100000001n
    t1 = f + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (e ^ (c & (d ^ e))) + constants[index + 2] + words[index + 2]
    b = u32(b + t1)
    f = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((g & h) | (a & (g | h))))
    rotE = b * 0x100000001n; rotA = f * 0x100000001n
    t1 = e + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (d ^ (b & (c ^ d))) + constants[index + 3] + words[index + 3]
    a = u32(a + t1)
    e = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((f & g) | (h & (f | g))))
    rotE = a * 0x100000001n; rotA = e * 0x100000001n
    t1 = d + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (c ^ (a & (b ^ c))) + constants[index + 4] + words[index + 4]
    h = u32(h + t1)
    d = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((e & f) | (g & (e | f))))
    rotE = h * 0x100000001n; rotA = d * 0x100000001n
    t1 = c + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (b ^ (h & (a ^ b))) + constants[index + 5] + words[index + 5]
    g = u32(g + t1)
    c = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((d & e) | (f & (d | e))))
    rotE = g * 0x100000001n; rotA = c * 0x100000001n
    t1 = b + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (a ^ (g & (h ^ a))) + constants[index + 6] + words[index + 6]
    f = u32(f + t1)
    b = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((c & d) | (e & (c | d))))
    rotE = f * 0x100000001n; rotA = b * 0x100000001n
    t1 = a + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (h ^ (f & (g ^ h))) + constants[index + 7] + words[index + 7]
    e = u32(e + t1)
    a = u32(t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((b & c) | (d & (b | c))))
  }
  return [a, b, c, d, e, f, g, h]
}

export function generateSecMsGecV2(unixTimestamp?: number): string {
  const now = unixTimestamp ?? Date.now() / 1000
  let ticks = now + WIN_EPOCH
  ticks -= ticks % 300
  ticks *= TICKS_PER_SECOND
  ticks = Math.floor(ticks)
  // ticks está muito acima de 2^53: o double é um inteiro exato e String imprime todos os dígitos
  const strToHash = String(ticks) + TRUSTED_CLIENT_TOKEN
  const data = Buffer.from(strToHash, 'ascii')
  const { cs64, sha256 } = tokenHash(data)
  return `${cs64}-${sha256}`
}

function tokenHash(data: Buffer): { cs64: string; sha256: string } {
  const digest = sha256Digest(data)
  const [sLast, sAcc] = cs64Digest(data, digest)
  const a = u32(sLast)
  const b = u32(sAcc)
  const bytes = [
    Number(a & 0xffn), Number((a >> 8n) & 0xffn), Number((a >> 16n) & 0xffn), Number((a >> 24n) & 0xffn),
    Number(b & 0xffn), Number((b >> 8n) & 0xffn), Number((b >> 16n) & 0xffn), Number((b >> 24n) & 0xffn),
  ]
  return {
    cs64: Buffer.from(bytes).toString('hex').toUpperCase(),
    sha256: digest.toString('hex').toUpperCase(),
  }
}

function sha256Digest(data: Buffer): Buffer {
  const length = BigInt(57 + data.length)
  const padZeroes = Number(((55n - length) % 64n + 64n * 64n) % 64n)
  let padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(padZeroes)])
  const tail = Buffer.alloc(8)
  tail.writeBigUInt64BE(length * 8n)
  padded = Buffer.concat([padded, tail])
  let state = sha256Init(Buffer.from(data.subarray(0, 7)))
  for (let offset = 0; offset < padded.length; offset += 64) {
    const block = padded.subarray(offset, offset + 64)
    const words: bigint[] = []
    for (let i = 0; i < 16; i++) words.push(BigInt(block.readUInt32BE(i * 4)))
    expandSha256Schedule(words)
    const working = sha256Rounds(state, words)
    state = state.map((x, i) => u32(x + working[i]))
  }
  const out = Buffer.alloc(32)
  for (let i = 0; i < 8; i++) out.writeUInt32BE(Number(state[i]), i * 4)
  return out
}

function sha256Init(data: Buffer): bigint[] {
  // data = os 7 primeiros bytes do token
  const words: bigint[] = new Array(14).fill(0n)
  words.push(BigInt((data[0] << 16) | (data[1] << 8) | data[2])) // int.from_bytes(data[:3], 'big')
  words.push(BigInt((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6])) // int.from_bytes(data[3:7], 'big')
  for (let index = 16; index < 30; index++) {
    let value = SHA256_SCHEDULE[index - 16]
    if (index - 2 >= 14) {
      const s1 = sigma1(words[index - 2])
      value += index === 16 ? s1 ^ SHA256_SIGMA1_ADJUSTMENT : s1
    }
    if (index - 7 >= 14) value += words[index - 7]
    if (index - 15 >= 14) {
      const s0 = sigma0(words[index - 15])
      value += index === 29 ? s0 ^ SHA256_SIGMA0_ADJUSTMENT : s0
    }
    words.push(u32(value))
  }
  words.push(u32(sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]))
  expandSha256Schedule(words, 31)
  const working = sha256Rounds(SHA256_STATE, words, 14)
  return SHA256_INITIAL.map((x, i) => u32(x + working[i]))
}

function cs64Digest(data: Buffer, digest: Buffer): [bigint, bigint] {
  const keyA = BigInt(digest.readUInt32LE(0)) | 1n
  const keyB = BigInt(digest.readUInt32LE(4)) | 1n
  const factors: [bigint, bigint] = [u32(keyA * CS64_FACTOR), u32(keyB * CS64_FACTOR)]
  const terms: bigint[] = []
  const offsets: bigint[] = []
  for (let i = 0; i < CS64_COEFFICIENTS.length; i++) {
    const [coefficient, offset] = CS64_COEFFICIENTS[i]
    terms.push(u32(BigInt(coefficient) * factors[i % 2]))
    offsets.push(BigInt(offset))
  }
  const withLeadingZero = Buffer.concat([Buffer.from([0]), data])
  const words = wordsLE4Even(withLeadingZero)
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    let term = word * (index % 2 === 0 ? keyA : keyB)
    let offset = rol16(word) * (index % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn)
    if (index === 0) {
      term += CS64_ADJUSTMENT0 * factors[0]
      offset += CS64_ADJUSTMENT1
    }
    terms.push(u32(term))
    offsets.push(u32(offset))
  }
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index]
    const y = terms[index + 1]
    let t = rol16(u32(offsets[index] + x))
    let q = u32(t * 0x76F50F34n)
    swapAcc += u32(rol16(q) * 0xC3EFEA97n + q)
    t = rol16(u32(offsets[index + 1] + y))
    q = u32(t * 0x1881CE3Cn)
    swapLast = u32(rol16(q) * 0x35BD1EC9n + q)
    swapAcc = u32(swapAcc + swapLast)
    state = u32(state * keyA + x)
    state = u32(rol16(state) * 0xCF98B111n)
    state = u32(rol16(state) * 0x87085B9Fn)
    state = u32(rol16(state) * 0x12CEB96Dn)
    state = u32(rol16(state) * 0x257E1D83n)
    acc += state
    t = u32(state * keyB + y)
    t = u32(rol16(t) * 0xA27416F5n)
    t = u32(rol16(t) * 0xD38396FFn)
    state = u32(rol16(u32(rol16(t) * 0x7C932B89n)) * 0xBFA49F69n)
    acc = u32(acc + state)
  }
  return [swapLast ^ state, swapAcc ^ acc]
}
