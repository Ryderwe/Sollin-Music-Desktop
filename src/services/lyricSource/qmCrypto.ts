const QRC_KEY = '!@#)(*$%123ZXC!@!@#)(NHL'

const ENCRYPT = 1
const DECRYPT = 0

const SBOX = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
  ],
]

const keyRoundShift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const keyPermC = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35]
const keyPermD = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3]
const keyCompression = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
  40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
]

type DesSchedule = number[][]

const bitnum = (input: Uint8Array, bitIndex: number, shift: number): number => {
  const byteIndex = Math.floor(bitIndex / 32) * 4 + 3 - Math.floor((bitIndex % 32) / 8)
  if (byteIndex >= input.length) return 0
  return (((input[byteIndex] >>> (7 - (bitIndex % 8))) & 1) << shift) | 0
}

const bitnumIntr = (input: number, bitIndex: number, shift: number): number =>
  ((((input >>> (31 - bitIndex)) & 1) << shift) | 0)

const bitnumIntl = (input: number, bitIndex: number, shift: number): number =>
  (((input << bitIndex) & 0x80000000) >>> shift)

const sboxBit = (value: number): number =>
  (value & 32) | ((value & 31) >>> 1) | ((value & 1) << 4)

const initialPermutation = (input: Uint8Array): [number, number] => {
  const s0 = (
    bitnum(input, 57, 31) | bitnum(input, 49, 30) | bitnum(input, 41, 29) | bitnum(input, 33, 28)
    | bitnum(input, 25, 27) | bitnum(input, 17, 26) | bitnum(input, 9, 25) | bitnum(input, 1, 24)
    | bitnum(input, 59, 23) | bitnum(input, 51, 22) | bitnum(input, 43, 21) | bitnum(input, 35, 20)
    | bitnum(input, 27, 19) | bitnum(input, 19, 18) | bitnum(input, 11, 17) | bitnum(input, 3, 16)
    | bitnum(input, 61, 15) | bitnum(input, 53, 14) | bitnum(input, 45, 13) | bitnum(input, 37, 12)
    | bitnum(input, 29, 11) | bitnum(input, 21, 10) | bitnum(input, 13, 9) | bitnum(input, 5, 8)
    | bitnum(input, 63, 7) | bitnum(input, 55, 6) | bitnum(input, 47, 5) | bitnum(input, 39, 4)
    | bitnum(input, 31, 3) | bitnum(input, 23, 2) | bitnum(input, 15, 1) | bitnum(input, 7, 0)
  ) | 0

  const s1 = (
    bitnum(input, 56, 31) | bitnum(input, 48, 30) | bitnum(input, 40, 29) | bitnum(input, 32, 28)
    | bitnum(input, 24, 27) | bitnum(input, 16, 26) | bitnum(input, 8, 25) | bitnum(input, 0, 24)
    | bitnum(input, 58, 23) | bitnum(input, 50, 22) | bitnum(input, 42, 21) | bitnum(input, 34, 20)
    | bitnum(input, 26, 19) | bitnum(input, 18, 18) | bitnum(input, 10, 17) | bitnum(input, 2, 16)
    | bitnum(input, 60, 15) | bitnum(input, 52, 14) | bitnum(input, 44, 13) | bitnum(input, 36, 12)
    | bitnum(input, 28, 11) | bitnum(input, 20, 10) | bitnum(input, 12, 9) | bitnum(input, 4, 8)
    | bitnum(input, 62, 7) | bitnum(input, 54, 6) | bitnum(input, 46, 5) | bitnum(input, 38, 4)
    | bitnum(input, 30, 3) | bitnum(input, 22, 2) | bitnum(input, 14, 1) | bitnum(input, 6, 0)
  ) | 0

  return [s0, s1]
}

const inversePermutation = (s0: number, s1: number): Uint8Array => {
  const data = new Uint8Array(8)
  data[3] = bitnumIntr(s1, 7, 7) | bitnumIntr(s0, 7, 6) | bitnumIntr(s1, 15, 5) | bitnumIntr(s0, 15, 4) | bitnumIntr(s1, 23, 3) | bitnumIntr(s0, 23, 2) | bitnumIntr(s1, 31, 1) | bitnumIntr(s0, 31, 0)
  data[2] = bitnumIntr(s1, 6, 7) | bitnumIntr(s0, 6, 6) | bitnumIntr(s1, 14, 5) | bitnumIntr(s0, 14, 4) | bitnumIntr(s1, 22, 3) | bitnumIntr(s0, 22, 2) | bitnumIntr(s1, 30, 1) | bitnumIntr(s0, 30, 0)
  data[1] = bitnumIntr(s1, 5, 7) | bitnumIntr(s0, 5, 6) | bitnumIntr(s1, 13, 5) | bitnumIntr(s0, 13, 4) | bitnumIntr(s1, 21, 3) | bitnumIntr(s0, 21, 2) | bitnumIntr(s1, 29, 1) | bitnumIntr(s0, 29, 0)
  data[0] = bitnumIntr(s1, 4, 7) | bitnumIntr(s0, 4, 6) | bitnumIntr(s1, 12, 5) | bitnumIntr(s0, 12, 4) | bitnumIntr(s1, 20, 3) | bitnumIntr(s0, 20, 2) | bitnumIntr(s1, 28, 1) | bitnumIntr(s0, 28, 0)
  data[7] = bitnumIntr(s1, 3, 7) | bitnumIntr(s0, 3, 6) | bitnumIntr(s1, 11, 5) | bitnumIntr(s0, 11, 4) | bitnumIntr(s1, 19, 3) | bitnumIntr(s0, 19, 2) | bitnumIntr(s1, 27, 1) | bitnumIntr(s0, 27, 0)
  data[6] = bitnumIntr(s1, 2, 7) | bitnumIntr(s0, 2, 6) | bitnumIntr(s1, 10, 5) | bitnumIntr(s0, 10, 4) | bitnumIntr(s1, 18, 3) | bitnumIntr(s0, 18, 2) | bitnumIntr(s1, 26, 1) | bitnumIntr(s0, 26, 0)
  data[5] = bitnumIntr(s1, 1, 7) | bitnumIntr(s0, 1, 6) | bitnumIntr(s1, 9, 5) | bitnumIntr(s0, 9, 4) | bitnumIntr(s1, 17, 3) | bitnumIntr(s0, 17, 2) | bitnumIntr(s1, 25, 1) | bitnumIntr(s0, 25, 0)
  data[4] = bitnumIntr(s1, 0, 7) | bitnumIntr(s0, 0, 6) | bitnumIntr(s1, 8, 5) | bitnumIntr(s0, 8, 4) | bitnumIntr(s1, 16, 3) | bitnumIntr(s0, 16, 2) | bitnumIntr(s1, 24, 1) | bitnumIntr(s0, 24, 0)
  return data
}

const f = (state: number, key: number[]): number => {
  const t1 = (
    bitnumIntl(state, 31, 0) | ((state & -0x10000000) >>> 1) | bitnumIntl(state, 4, 5)
    | bitnumIntl(state, 3, 6) | ((state & 0x0f000000) >>> 3) | bitnumIntl(state, 8, 11)
    | bitnumIntl(state, 7, 12) | ((state & 0x00f00000) >>> 5) | bitnumIntl(state, 12, 17)
    | bitnumIntl(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitnumIntl(state, 16, 23)
  ) | 0

  const t2 = (
    bitnumIntl(state, 15, 0) | ((state & 0x0000f000) << 15) | bitnumIntl(state, 20, 5)
    | bitnumIntl(state, 19, 6) | ((state & 0x00000f00) << 13) | bitnumIntl(state, 24, 11)
    | bitnumIntl(state, 23, 12) | ((state & 0x000000f0) << 11) | bitnumIntl(state, 28, 17)
    | bitnumIntl(state, 27, 18) | ((state & 0x0000000f) << 9) | bitnumIntl(state, 0, 23)
  ) | 0

  const lrgstate = [
    (t1 >>> 24) & 0xff,
    (t1 >>> 16) & 0xff,
    (t1 >>> 8) & 0xff,
    (t2 >>> 24) & 0xff,
    (t2 >>> 16) & 0xff,
    (t2 >>> 8) & 0xff,
  ]

  for (let i = 0; i < 6; i++) lrgstate[i] = (lrgstate[i] ^ key[i]) & 0xff

  const resState = (
    (SBOX[0][sboxBit(lrgstate[0] >>> 2)] << 28)
    | (SBOX[1][sboxBit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >>> 4))] << 24)
    | (SBOX[2][sboxBit(((lrgstate[1] & 0x0f) << 2) | (lrgstate[2] >>> 6))] << 20)
    | (SBOX[3][sboxBit(lrgstate[2] & 0x3f)] << 16)
    | (SBOX[4][sboxBit(lrgstate[3] >>> 2)] << 12)
    | (SBOX[5][sboxBit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >>> 4))] << 8)
    | (SBOX[6][sboxBit(((lrgstate[4] & 0x0f) << 2) | (lrgstate[5] >>> 6))] << 4)
    | SBOX[7][sboxBit(lrgstate[5] & 0x3f)]
  ) | 0

  return (
    bitnumIntl(resState, 15, 0) | bitnumIntl(resState, 6, 1) | bitnumIntl(resState, 19, 2)
    | bitnumIntl(resState, 20, 3) | bitnumIntl(resState, 28, 4) | bitnumIntl(resState, 11, 5)
    | bitnumIntl(resState, 27, 6) | bitnumIntl(resState, 16, 7) | bitnumIntl(resState, 0, 8)
    | bitnumIntl(resState, 14, 9) | bitnumIntl(resState, 22, 10) | bitnumIntl(resState, 25, 11)
    | bitnumIntl(resState, 4, 12) | bitnumIntl(resState, 17, 13) | bitnumIntl(resState, 30, 14)
    | bitnumIntl(resState, 9, 15) | bitnumIntl(resState, 1, 16) | bitnumIntl(resState, 7, 17)
    | bitnumIntl(resState, 23, 18) | bitnumIntl(resState, 13, 19) | bitnumIntl(resState, 31, 20)
    | bitnumIntl(resState, 26, 21) | bitnumIntl(resState, 2, 22) | bitnumIntl(resState, 8, 23)
    | bitnumIntl(resState, 18, 24) | bitnumIntl(resState, 12, 25) | bitnumIntl(resState, 29, 26)
    | bitnumIntl(resState, 5, 27) | bitnumIntl(resState, 21, 28) | bitnumIntl(resState, 10, 29)
    | bitnumIntl(resState, 3, 30) | bitnumIntl(resState, 24, 31)
  ) | 0
}

const cryptBlock = (input: Uint8Array, key: DesSchedule): Uint8Array => {
  let [s0, s1] = initialPermutation(input)

  for (let idx = 0; idx < 15; idx++) {
    const previousS1 = s1
    s1 = (f(s1, key[idx]) ^ s0) | 0
    s0 = previousS1
  }
  s0 = (f(s1, key[15]) ^ s0) | 0

  return inversePermutation(s0, s1)
}

const keySchedule = (key: Uint8Array, mode: number): DesSchedule => {
  const schedule = Array.from({ length: 16 }, () => Array(6).fill(0))

  let c = 0
  for (let i = 0; i < 28; i++) c = (c + bitnum(key, keyPermC[i], 31 - i)) | 0

  let d = 0
  for (let i = 0; i < 28; i++) d = (d + bitnum(key, keyPermD[i], 31 - i)) | 0

  for (let i = 0; i < 16; i++) {
    c = (((c << keyRoundShift[i]) | (c >>> (28 - keyRoundShift[i]))) & -0x10) | 0
    d = (((d << keyRoundShift[i]) | (d >>> (28 - keyRoundShift[i]))) & -0x10) | 0

    const targetRound = mode === DECRYPT ? 15 - i : i
    for (let j = 0; j < 6; j++) schedule[targetRound][j] = 0

    for (let j = 0; j < 24; j++) {
      schedule[targetRound][Math.floor(j / 8)] |= bitnumIntr(c, keyCompression[j], 7 - (j % 8))
    }
    for (let j = 24; j < 48; j++) {
      schedule[targetRound][Math.floor(j / 8)] |= bitnumIntr(d, keyCompression[j] - 27, 7 - (j % 8))
    }
  }

  return schedule
}

const sliceKey = (key: Uint8Array, start: number, end: number) => key.slice(start, end)

const tripleDesKeySetup = (key: Uint8Array, mode: number): DesSchedule[] => {
  if (mode === ENCRYPT) {
    return [
      keySchedule(sliceKey(key, 0, 8), ENCRYPT),
      keySchedule(sliceKey(key, 8, 16), DECRYPT),
      keySchedule(sliceKey(key, 16, 24), ENCRYPT),
    ]
  }
  return [
    keySchedule(sliceKey(key, 16, 24), DECRYPT),
    keySchedule(sliceKey(key, 8, 16), ENCRYPT),
    keySchedule(sliceKey(key, 0, 8), DECRYPT),
  ]
}

const tripleDesCrypt = (data: Uint8Array, schedules: DesSchedule[]): Uint8Array => {
  const result = new Uint8Array(data.length)

  for (let i = 0; i + 8 <= data.length; i += 8) {
    let temp: Uint8Array = new Uint8Array(8)
    temp.set(data.subarray(i, i + 8))
    for (let k = 0; k < 3; k++) temp = cryptBlock(temp, schedules[k])
    result.set(temp, i)
  }

  return result
}

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(Math.floor(hex.length / 2))
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const value = Number.parseInt(hex.slice(i, i + 2), 16)
    bytes[Math.floor(i / 2)] = Number.isFinite(value) ? value : 0
  }
  return bytes
}

const qrcKeyBytes = new TextEncoder().encode(QRC_KEY)
const qrcDecryptSchedules = tripleDesKeySetup(qrcKeyBytes, DECRYPT)

const inflateZlibStrict = async(data: Uint8Array): Promise<string> => {
  const Decompression = (globalThis as any).DecompressionStream
  if (typeof Decompression !== 'function') {
    throw new Error('DecompressionStream unavailable')
  }

  const input = new Uint8Array(data.length)
  input.set(data)
  const stream = new Blob([input.buffer]).stream().pipeThrough(new Decompression('deflate'))
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  return new TextDecoder('utf-8').decode(output)
}

const inflateZlib = async(data: Uint8Array): Promise<string> => {
  let lastError: unknown = null

  for (let trim = 0; trim < 8 && data.length - trim > 0; trim++) {
    try {
      return await inflateZlibStrict(trim === 0 ? data : data.slice(0, data.length - trim))
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('QRC inflate failed')
}

export const decryptQrc = async(rawHexString: string | undefined): Promise<string> => {
  const hex = (rawHexString || '').replace(/[^0-9A-Fa-f]/g, '')
  if (!hex) return ''

  const encrypted = hexToBytes(hex)
  if (!encrypted.length || encrypted.length % 8 !== 0) return ''

  const decrypted = tripleDesCrypt(encrypted, qrcDecryptSchedules)
  return inflateZlib(decrypted)
}
