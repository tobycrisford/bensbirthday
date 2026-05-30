async function generate_key(pswd, salt) {
    
    const encoder = new TextEncoder();
    const data = encoder.encode(pswd);

    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        data,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );
        
    return await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

export function generate_random_pswd() {
    const pswd_bytes = new Uint8Array(12);
    crypto.getRandomValues(pswd_bytes);
    return uint8ArrayToBase64(new Uint8Array(pswd_bytes));
}

function uint8ArrayToBase64(bytes) {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

export async function encrypt_bytes(data, pswd, salt) {
    
    const key = await generate_key(pswd, salt);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    
    const encryptedData = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        data
    );

    return {
        encrypted_text: uint8ArrayToBase64(new Uint8Array(encryptedData)),
        iv: btoa(String.fromCharCode.apply(null, iv))
    }
}

export async function decrypt_bytes(cyphertext, pswd, salt, iv) {

    const key = await generate_key(pswd, salt);

    const encryptedData = Uint8Array.from(atob(cyphertext), c => c.charCodeAt(0)).buffer;
    const ivData = Uint8Array.from(atob(iv), c => c.charCodeAt(0));

    const decryptedData = await window.crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: ivData
        },
        key,
        encryptedData
    );

    return decryptedData;
}
