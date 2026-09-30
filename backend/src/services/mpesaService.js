import crypto from 'crypto';

import { config } from '../config.js';

function getDarajaAuthToken() {
  if (!config.mpesa.consumerKey || !config.mpesa.consumerSecret) {
    return {
      mode: 'stub',
      access_token: 'stub-token'
    };
  }

  const auth = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64');

  return {
    mode: 'live',
    authorization: `Basic ${auth}`
  };
}

function generateTimestamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return `${y}${m}${d}${hh}${mm}${ss}`;
}

function generatePassword(shortCode, passKey, timestamp) {
  return Buffer.from(`${shortCode}${passKey}${timestamp}`).toString('base64');
}

export async function initiateStkPush({ phoneNumber, amount, bookingId, eventTitle }) {
  const timestamp = generateTimestamp();
  const shortCode = config.mpesa.shortCode;
  const passKey = config.mpesa.passKey;

  const requestId = `THK-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const accountRef = eventTitle || 'TwendeHike';

  if (!config.mpesa.consumerKey || !config.mpesa.consumerSecret || !config.mpesa.passKey) {
    return {
      success: true,
      mode: 'stub',
      merchantRequestID: requestId,
      checkoutRequestID: `ws_CO_${Date.now()}`,
      responseDescription: 'STK push simulation activated. Callback will be accepted in mock mode.',
      customerMessage: 'M-PESA STK Push simulated successfully.'
    };
  }

  const tokenResponse = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64')}`
    }
  });

  const tokenData = await tokenResponse.json();

  const password = generatePassword(shortCode, passKey, timestamp);

  const response = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Number(amount),
      PartyA: phoneNumber,
      PartyB: shortCode,
      PhoneNumber: phoneNumber,
      CallBackURL: config.mpesa.callbackUrl,
      AccountReference: accountRef,
      TransactionDesc: `Twende Hike booking ${bookingId}`
    })
  });

  return response.json();
}

export function handleMpesaCallback(rawBody) {
  const callback = rawBody?.Body?.stkCallback || rawBody?.callback || rawBody;

  if (!callback) {
    throw new Error('Invalid M-PESA callback payload.');
  }

  const metadata = callback.CallbackMetadata?.Item || [];
  const lookup = Object.fromEntries(
    metadata.map((item) => [item.Name, item.Value])
  );

  const payment = {
    merchantRequestId: callback.MerchantRequestID,
    checkoutRequestId: callback.CheckoutRequestID,
    resultCode: callback.ResultCode,
    resultDesc: callback.ResultDesc,
    mpesaReceiptNumber: lookup?.MpesaReceiptNumber || null,
    amount: lookup?.Amount || null,
    phoneNumber: lookup?.PhoneNumber || null,
    transactionDate: lookup?.TransactionDate || null,
    createdAt: new Date().toISOString()
  };

  return payment;
}

export function verifyCallbackSignature(signature, payload) {
  if (!signature) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', process.env.MPESA_SIGNATURE_KEY || 'dev-signature-key')
    .update(JSON.stringify(payload))
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
