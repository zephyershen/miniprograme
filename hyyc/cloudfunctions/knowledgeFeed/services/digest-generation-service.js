function createDigestGenerationService({ provider }) {
  async function runDue() {
    if (!provider || provider.enabled !== true) {
      return { status: 'disabled', generated: [] };
    }
    return { status: 'idle', generated: [] };
  }

  return { runDue };
}

module.exports = { createDigestGenerationService };
