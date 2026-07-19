// lib/netease/crypto.ts — NetEase 网易云音乐加密算法（weapi/eapi），移植自 NeteaseCloudMusicApi/util/crypto.js。
// crypto-js 和 node-forge 都是纯浏览器兼容库，逻辑原样保留，只是从 CommonJS/Node 换成 TS/ESM，
// 好让它能直接跑在 Capacitor WebView 里，不需要任何 Node 运行时。

import CryptoJS from "crypto-js";
import forge from "node-forge";

const IV = "0102030405060708";
const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;
const EAPI_KEY = "e82ckenh8dichen8";

type AesMode = "cbc" | "ecb";

function aesEncrypt(text: string, mode: AesMode, key: string, iv: string, format: "base64" | "hex" = "base64"): string {
    const encrypted = CryptoJS.AES.encrypt(
        CryptoJS.enc.Utf8.parse(text),
        CryptoJS.enc.Utf8.parse(key),
        {
            iv: CryptoJS.enc.Utf8.parse(iv),
            mode: mode === "cbc" ? CryptoJS.mode.CBC : CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7,
        },
    );
    if (format === "base64") return encrypted.toString();
    return encrypted.ciphertext.toString().toUpperCase();
}

function aesDecrypt(ciphertext: string, key: string, iv: string, format: "base64" | "hex" = "base64"): CryptoJS.lib.WordArray {
    if (format === "base64") {
        return CryptoJS.AES.decrypt(ciphertext, CryptoJS.enc.Utf8.parse(key), {
            iv: CryptoJS.enc.Utf8.parse(iv),
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7,
        });
    }
    return CryptoJS.AES.decrypt(
        { ciphertext: CryptoJS.enc.Hex.parse(ciphertext) } as CryptoJS.lib.CipherParams,
        CryptoJS.enc.Utf8.parse(key),
        {
            iv: CryptoJS.enc.Utf8.parse(iv),
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7,
        },
    );
}

function rsaEncrypt(str: string, key: string): string {
    const publicKey = forge.pki.publicKeyFromPem(key);
    const encrypted = publicKey.encrypt(str, "NONE");
    return forge.util.bytesToHex(encrypted);
}

export function weapi(payload: Record<string, unknown>): { params: string; encSecKey: string } {
    const text = JSON.stringify(payload);
    let secretKey = "";
    for (let i = 0; i < 16; i++) {
        secretKey += BASE62.charAt(Math.round(Math.random() * 61));
    }
    return {
        params: aesEncrypt(aesEncrypt(text, "cbc", PRESET_KEY, IV), "cbc", secretKey, IV),
        encSecKey: rsaEncrypt(secretKey.split("").reverse().join(""), PUBLIC_KEY),
    };
}

export function eapi(url: string, payload: Record<string, unknown> | string): { params: string } {
    const text = typeof payload === "object" ? JSON.stringify(payload) : payload;
    const message = `nobody${url}use${text}md5forencrypt`;
    const digest = CryptoJS.MD5(message).toString();
    const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
    return { params: aesEncrypt(data, "ecb", EAPI_KEY, "", "hex") };
}

/**
 * 只覆盖 encryptResponse=false（NetEase 默认配置）时的普通解密路径。
 * 原版还有个 gzip 压缩分支（aeapi），依赖 Node 的 zlib，但那只在服务端主动设置
 * x-aeapi 请求头、要求压缩响应时才会触发，这里不发那个头，用不到。
 */
export function eapiResDecrypt(encryptedParamsHex: string): unknown {
    try {
        const decrypted = aesDecrypt(encryptedParamsHex, EAPI_KEY, "", "hex");
        return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
    } catch (error) {
        console.warn("[NeteaseCrypto] eapiResDecrypt failed:", error);
        return null;
    }
}
