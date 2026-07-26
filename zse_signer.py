"""
zse_signer.py -- Python 移植 zse96 v2 签名算法 (来自 zhihu-plus-plus / zhihu-mcp-server)

用法:
    from zse_signer import sign_request
    signature = sign_request("https://www.zhihu.com/api/v4/questions/123/answers", "d_c0_value")
    # → "2.0_xxxx..."
"""

import hashlib
import urllib.parse

ZK = [
    0x45C2D1B2, 0x3D0F0FFE, 0x5440EB87, 0xEB84FDC0,
    0xD25C13CE, 0xAE23C1FE, 0xF78B8A88, 0xEE520C03,
    0x7341B3CA, 0xC60C7C7B, 0xE7C79C6A, 0x1B72A076,
    0xDF68C78A, 0x8F3FE08A, 0x9BE10FA3, 0x7E50A394,
    0x87143E4B, 0x794E166C, 0xA550683A, 0xFFA1D419,
    0xFB5F13C3, 0x832A5CE3, 0xB5E15E1A, 0x5E2F45CF,
    0x4EC29A52, 0x1B38C114, 0xAD11960F, 0xF2562F1F,
    0x13AC1F96, 0xD111625E, 0x15AA2E59, 0x8BD5057B,
]

ZB = [
    20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91,
    237, 9, 125, 157, 230, 93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167,
    39, 37, 156, 198, 38, 42, 43, 168, 217, 153, 15, 103, 80, 189, 71, 191,
    97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148, 86, 182,
    32, 83, 158, 109, 22, 255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26,
    123, 176, 232, 193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218,
    196, 229, 1, 192, 213, 27, 110, 56, 231, 180, 138, 107, 242, 187, 54, 120,
    19, 44, 117, 228, 215, 203, 53, 239, 251, 127, 81, 11, 133, 96, 204, 132,
    41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
    174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68,
    207, 160, 65, 111, 82, 165, 67, 169, 225, 57, 112, 244, 155, 51, 236, 200,
    233, 58, 61, 47, 100, 137, 185, 64, 17, 70, 234, 163, 219, 108, 170, 166,
    59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136, 206, 135,
    175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130, 98, 241, 40,
    154, 66, 184, 49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179,
    210, 134, 250, 201, 164, 89, 216, 202, 220, 50, 221, 152, 140, 33, 235, 214,
]

ALPHABET = "6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE"
KEY16 = b"059053f7d15e01d7"  # "059053f7d15e01d7" in utf-8


def _read_u32_be(b, off):
    return (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]


def _write_u32_be(v, out, off):
    out[off] = (v >> 24) & 0xFF
    out[off + 1] = (v >> 16) & 0xFF
    out[off + 2] = (v >> 8) & 0xFF
    out[off + 3] = v & 0xFF


def _rotl(n, bits):
    return ((n << bits) | (n >> (32 - bits))) & 0xFFFFFFFF


def _g_transform(tt):
    te0 = (tt >> 24) & 0xFF
    te1 = (tt >> 16) & 0xFF
    te2 = (tt >> 8) & 0xFF
    te3 = tt & 0xFF
    ti = (ZB[te0] << 24) | (ZB[te1] << 16) | (ZB[te2] << 8) | ZB[te3]
    return (ti ^ _rotl(ti, 2) ^ _rotl(ti, 10) ^ _rotl(ti, 18) ^ _rotl(ti, 24)) & 0xFFFFFFFF


def _r_block(input16):
    tr = [0] * 36
    tr[0] = _read_u32_be(input16, 0)
    tr[1] = _read_u32_be(input16, 4)
    tr[2] = _read_u32_be(input16, 8)
    tr[3] = _read_u32_be(input16, 12)
    for i in range(32):
        ta = _g_transform((tr[i + 1] ^ tr[i + 2] ^ tr[i + 3] ^ ZK[i]) & 0xFFFFFFFF)
        tr[i + 4] = (tr[i] ^ ta) & 0xFFFFFFFF
    out = bytearray(16)
    _write_u32_be(tr[35], out, 0)
    _write_u32_be(tr[34], out, 4)
    _write_u32_be(tr[33], out, 8)
    _write_u32_be(tr[32], out, 12)
    return bytes(out)


def _x_blocks(data, iv0):
    iv = bytearray(iv0)
    out = bytearray(len(data))
    off = 0
    while off < len(data):
        mixed = bytearray(16)
        for i in range(16):
            mixed[i] = data[off + i] ^ iv[i]
        iv = bytearray(_r_block(bytes(mixed)))
        out[off:off + 16] = iv
        off += 16
    return bytes(out)


def _custom_encode(bytes_in):
    data = bytearray(bytes_in)
    rem = len(data) % 3
    if rem != 0:
        data.extend([0] * (3 - rem))
    out_chars = []
    i = 0
    p = len(data) - 1
    while p >= 0:
        b0 = data[p] & 0xFF
        m0 = (58 >> (8 * (i % 4))) & 0xFF
        i += 1
        v = (b0 ^ m0) & 0xFF
        b1 = data[p - 1] & 0xFF
        m1 = (58 >> (8 * (i % 4))) & 0xFF
        i += 1
        v |= ((b1 ^ m1) & 0xFF) << 8
        b2 = data[p - 2] & 0xFF
        m2 = (58 >> (8 * (i % 4))) & 0xFF
        i += 1
        v |= ((b2 ^ m2) & 0xFF) << 16
        out_chars.append(ALPHABET[v & 63])
        out_chars.append(ALPHABET[(v >> 6) & 63])
        out_chars.append(ALPHABET[(v >> 12) & 63])
        out_chars.append(ALPHABET[(v >> 18) & 63])
        p -= 3
    return "".join(out_chars)


def encrypt_zse_v4(input_str):
    plain = bytearray()
    plain.append(210)
    plain.append(0)
    encoded = urllib.parse.quote(input_str, safe='')
    plain.extend(encoded.encode("utf-8"))
    pad = 16 - (len(plain) % 16)
    if pad == 16:
        pad = 0
    plain.extend([pad] * pad)
    plain_bytes = bytes(plain)
    first = bytearray(16)
    for i in range(16):
        first[i] = plain_bytes[i] ^ KEY16[i] ^ 42
    c0 = _r_block(bytes(first))
    if len(plain_bytes) <= 16:
        return _custom_encode(c0)
    cipher = bytearray(len(plain_bytes))
    cipher[:16] = c0
    rest = _x_blocks(plain_bytes[16:], c0)
    cipher[16:] = rest
    return _custom_encode(bytes(cipher))


def sign_request(url, dc0="", body=None, zse93="101_3_3.0"):
    pathname = "/" + "/".join(url.split("//", 1)[1].split("/")[1:]) if "//" in url else url
    parts = [zse93, pathname, dc0]
    if body is not None:
        parts.append(body)
    sign_source = "+".join(parts)
    md5_hex = hashlib.md5(sign_source.encode("utf-8")).hexdigest()
    signature = encrypt_zse_v4(md5_hex)
    return f"2.0_{signature}"
