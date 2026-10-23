'use strict';

const QUARTILE_ECC_CODEWORDS = [0, 13, 22, 18, 26, 18];
const DATA_BLOCK_LENGTHS = [[], [13], [22], [17, 17], [24, 24], [15, 15, 16, 16]];
const DATA_CODEWORDS = [0, 13, 22, 34, 48, 62];

function multiply(a, b) {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    if ((b >>> i) & 1) result ^= a;
  }
  return result;
}

function reedSolomon(data, degree) {
  let generator = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array(generator.length + 1).fill(0);
    generator.forEach((value, index) => {
      next[index] ^= value;
      next[index + 1] ^= multiply(value, root);
    });
    generator = next;
    root = multiply(root, 2);
  }
  const remainder = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    if (factor) generator.forEach((value, index) => { remainder[i + index] ^= multiply(value, factor); });
  }
  return remainder.slice(data.length);
}

function appendBits(target, value, length) {
  for (let bit = length - 1; bit >= 0; bit--) target.push((value >>> bit) & 1);
}

function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  const version = [1, 2, 3, 4, 5].find(value => bytes.length <= DATA_CODEWORDS[value] - 2);
  if (!version) throw new Error('Текст слишком длинный для встроенного QR-кода.');

  const dataBits = [];
  appendBits(dataBits, 0b0100, 4);
  appendBits(dataBits, bytes.length, 8);
  bytes.forEach(byte => appendBits(dataBits, byte, 8));
  const capacity = DATA_CODEWORDS[version] * 8;
  appendBits(dataBits, 0, Math.min(4, capacity - dataBits.length));
  while (dataBits.length % 8) dataBits.push(0);
  const data = [];
  for (let i = 0; i < dataBits.length; i += 8) {
    data.push(dataBits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; data.length < DATA_CODEWORDS[version]; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  let dataOffset = 0;
  const dataBlocks = DATA_BLOCK_LENGTHS[version].map(length => {
    const block = data.slice(dataOffset, dataOffset + length);
    dataOffset += length;
    return block;
  });
  const errorBlocks = dataBlocks.map(block => reedSolomon(block, QUARTILE_ECC_CODEWORDS[version]));
  const codewords = [];
  for (let i = 0; i < Math.max(...DATA_BLOCK_LENGTHS[version]); i++) {
    for (const block of dataBlocks) if (block[i] !== undefined) codewords.push(block[i]);
  }
  for (let i = 0; i < QUARTILE_ECC_CODEWORDS[version]; i++) {
    for (const block of errorBlocks) codewords.push(block[i]);
  }
  const size = 17 + version * 4;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (x, y, value) => { if (x >= 0 && y >= 0 && x < size && y < size) matrix[y][x] = Boolean(value); };

  const finder = (cx, cy) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      const within = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark = within && (dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
        (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      set(x, y, dark);
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  const alignment = version === 1 ? [] : [6, 10 + version * 4];
  for (const x of alignment) for (const y of alignment) {
    if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  const writeFormat = mask => {
    const formatData = (0b11 << 3) | mask;
    let remainder = formatData << 10;
    for (let i = 14; i >= 10; i--) if ((remainder >>> i) & 1) remainder ^= 0x537 << (i - 10);
    const bits = ((formatData << 10) | remainder) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, (bits >>> i) & 1);
    set(8, 7, (bits >>> 6) & 1);
    set(8, 8, (bits >>> 7) & 1);
    set(7, 8, (bits >>> 8) & 1);
    for (let i = 9; i < 15; i++) set(14 - i, 8, (bits >>> i) & 1);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, (bits >>> i) & 1);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, (bits >>> i) & 1);
    set(8, size - 8, true);
  };
  writeFormat(0);

  const bits = codewords.flatMap(byte => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (matrix[y][x] !== null) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex++] : 0;
        set(x, y, Boolean(bit) !== ((x + y) % 2 === 0));
      }
    }
  }
  writeFormat(0);
  return matrix;
}

function makeQrSvg(text) {
  const matrix = qrMatrix(text);
  const quietZone = 4;
  const size = matrix.length + quietZone * 2;
  const blocks = [];
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) blocks.push(`M${x + quietZone},${y + quietZone}h1v1h-1z`);
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#181926"/><path d="${blocks.join('')}" fill="#f3f4f8"/></svg>`;
}

if (typeof module !== 'undefined') module.exports = { qrMatrix, makeQrSvg };
if (typeof window !== 'undefined') window.HomeAuctionQR = { qrMatrix, makeQrSvg };
