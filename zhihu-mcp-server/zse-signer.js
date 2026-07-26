/**
 * Zhihu zse96 v2 signature implementation
 * Ported from zhihu-plus-plus project
 */

import crypto from 'crypto';

const ZK = new Uint32Array([
    1170614578, 1024848638, 1413669199, 3951632832, 3528873006, 2921909214, 4151847688, 3997739139,
    1933479194, 3323781115, 3888513386, 460404854, 3747539722, 2403641034, 2615871395, 2119585428,
    2265697227, 2035090028, 2773447226, 4289380121, 4217216195, 2200601443, 3051914490, 1579901135,
    1321810770, 456816404, 2903323407, 4065664991, 330002838, 3506006750, 363569021, 2347096187,
]);

const ZB = new Uint8Array([
    20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91, 237, 9, 125, 157, 230,
    93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167, 39, 37, 156, 198, 38, 42, 43, 168, 217,
    153, 15, 103, 80, 189, 71, 191, 97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148,
    86, 182, 32, 83, 158, 109, 22, 255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26, 123, 176, 232,
    193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218, 196, 229, 1, 192, 213, 27, 110,
    56, 231, 180, 138, 107, 242, 187, 54, 120, 19, 44, 117, 228, 215, 203, 53, 239, 251, 127, 81,
    11, 133, 96, 204, 132, 41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
    174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68, 207, 160, 65, 111, 82,
    165, 67, 169, 225, 57, 112, 244, 155, 51, 236, 200, 233, 58, 61, 47, 100, 137, 185, 64, 17, 70,
    234, 163, 219, 108, 170, 166, 59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136,
    206, 135, 175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130, 98, 241, 40, 154, 66, 184,
    49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179, 210, 134, 250, 201, 164, 89, 216,
    202, 220, 50, 221, 152, 140, 33, 235, 214,
]);

const ALPHABET = "6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE";
const KEY16 = Buffer.from("059053f7d15e01d7", "utf8");

function readU32Be(b, off) {
    return ((b[off] & 0xFF) << 24) |
           ((b[off + 1] & 0xFF) << 16) |
           ((b[off + 2] & 0xFF) << 8) |
           (b[off + 3] & 0xFF);
}

function writeU32Be(v, out, off) {
    out[off] = (v >>> 24) & 0xFF;
    out[off + 1] = (v >>> 16) & 0xFF;
    out[off + 2] = (v >>> 8) & 0xFF;
    out[off + 3] = v & 0xFF;
}

function rotateLeft(n, bits) {
    return ((n << bits) | (n >>> (32 - bits))) >>> 0;
}

function gTransform(tt) {
    const te0 = (tt >>> 24) & 0xFF;
    const te1 = (tt >>> 16) & 0xFF;
    const te2 = (tt >>> 8) & 0xFF;
    const te3 = tt & 0xFF;

    const ti = ((ZB[te0] & 0xFF) << 24) |
               ((ZB[te1] & 0xFF) << 16) |
               ((ZB[te2] & 0xFF) << 8) |
               (ZB[te3] & 0xFF);

    return (ti ^ rotateLeft(ti, 2) ^ rotateLeft(ti, 10) ^
            rotateLeft(ti, 18) ^ rotateLeft(ti, 24)) >>> 0;
}

function rBlock(input16) {
    const tr = new Uint32Array(36);
    tr[0] = readU32Be(input16, 0);
    tr[1] = readU32Be(input16, 4);
    tr[2] = readU32Be(input16, 8);
    tr[3] = readU32Be(input16, 12);

    for (let i = 0; i < 32; i++) {
        const ta = gTransform((tr[i + 1] ^ tr[i + 2] ^ tr[i + 3] ^ ZK[i]) >>> 0);
        tr[i + 4] = (tr[i] ^ ta) >>> 0;
    }

    const out = Buffer.alloc(16);
    writeU32Be(tr[35], out, 0);
    writeU32Be(tr[34], out, 4);
    writeU32Be(tr[33], out, 8);
    writeU32Be(tr[32], out, 12);
    return out;
}

function xBlocks(data, iv0) {
    let iv = Buffer.from(iv0);
    const out = Buffer.alloc(data.length);
    let outOff = 0;
    let off = 0;

    while (off < data.length) {
        const mixed = Buffer.alloc(16);
        for (let i = 0; i < 16; i++) {
            mixed[i] = data[off + i] ^ iv[i];
        }
        iv = rBlock(mixed);
        iv.copy(out, outOff);
        off += 16;
        outOff += 16;
    }
    return out;
}

function customEncode(bytesIn) {
    let bytes = Buffer.from(bytesIn);
    const rem = bytes.length % 3;
    if (rem !== 0) {
        bytes = Buffer.concat([bytes, Buffer.alloc(3 - rem)]);
    }

    let out = '';
    let i = 0;
    let p = bytes.length - 1;

    while (p >= 0) {
        let v = 0;

        const b0 = bytes[p] & 0xFF;
        const m0 = (58 >>> (8 * (i % 4))) & 0xFF;
        i += 1;
        v = v | ((b0 ^ m0) & 0xFF);

        const b1 = bytes[p - 1] & 0xFF;
        const m1 = (58 >>> (8 * (i % 4))) & 0xFF;
        i += 1;
        v = v | (((b1 ^ m1) & 0xFF) << 8);

        const b2 = bytes[p - 2] & 0xFF;
        const m2 = (58 >>> (8 * (i % 4))) & 0xFF;
        i += 1;
        v = v | (((b2 ^ m2) & 0xFF) << 16);

        out += ALPHABET[v & 63];
        out += ALPHABET[(v >>> 6) & 63];
        out += ALPHABET[(v >>> 12) & 63];
        out += ALPHABET[(v >>> 18) & 63];

        p -= 3;
    }

    return out;
}

export function encryptZseV4(input) {
    const plain = [];
    plain.push(210); // seed value matching Android implementation
    plain.push(0);

    // Add URL-encoded input
    const encoded = encodeURIComponent(input);
    for (let i = 0; i < encoded.length; i++) {
        plain.push(encoded.charCodeAt(i));
    }

    // Add padding
    const pad = 16 - (plain.length % 16);
    for (let i = 0; i < pad; i++) {
        plain.push(pad);
    }

    const plainBytes = Buffer.from(plain);
    const first = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
        first[i] = plainBytes[i] ^ KEY16[i] ^ 42;
    }

    const c0 = rBlock(first);
    const cipher = Buffer.alloc(plainBytes.length);
    c0.copy(cipher, 0);

    if (plainBytes.length > 16) {
        const rest = xBlocks(plainBytes.slice(16), c0);
        rest.copy(cipher, 16);
    }

    return customEncode(cipher);
}

export function signRequest(url, dc0 = '', body = null, zse93 = '101_3_3.0') {
    const pathname = '/' + url.split('//')[1].split('/').slice(1).join('/');
    const signSource = [zse93, pathname, dc0, body].filter(x => x !== null).join('+');
    const md5 = crypto.createHash('md5').update(signSource).digest('hex');
    const signature = encryptZseV4(md5);
    return `2.0_${signature}`;
}
