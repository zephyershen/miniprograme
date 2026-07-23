function isTransactionBusy(error) {
  const haystack = [error && error.code, error && error.errCode, error && error.message]
    .filter(Boolean)
    .join(' ');
  return /TransactionBusy|-501001|DATABASE_TRANSACTION_FAIL/i.test(haystack);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runBusyTransaction(db, work, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await db.runTransaction(work);
    } catch (error) {
      lastError = error;
      if (!isTransactionBusy(error) || attempt === attempts - 1) throw error;
      await wait(30 * (attempt + 1));
    }
  }
  throw lastError;
}

module.exports = { isTransactionBusy, runBusyTransaction };
