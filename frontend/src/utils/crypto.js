import CryptoJS from 'crypto-js';

// Pre-shared key for exercise operations
const SECTOR_COMMS_KEY = 'MILITARY_TACTICAL_SECTOR_COMMS_KEY_2026';

/**
 * Encrypts cleartext using AES-256-CBC algorithm
 */
export const encryptMessage = (text) => {
  if (!text) return '';
  return CryptoJS.AES.encrypt(text, SECTOR_COMMS_KEY).toString();
};

/**
 * Decrypts AES ciphertext back into readable string
 */
export const decryptMessage = (ciphertext) => {
  if (!ciphertext) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECTOR_COMMS_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted) return '[Decryption Error: Key mismatch or tampered frame]';
    return decrypted;
  } catch (e) {
    return '[Decryption Error: Ciphertext corrupted]';
  }
};
