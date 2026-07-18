const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error('AI_COLUMN_POSTER_DIRECTORY_REQUIRED');

const POSTERS = Object.freeze([
  ['agent1.png', 'agent-1.jpg'],
  ['agent2.png', 'agent-2.jpg'],
  ['agent3.png', 'agent-3.jpg'],
  ['skill1.png', 'skill-1.jpg'],
  ['skill2.png', 'skill-2.jpg'],
  ['skill3.png', 'skill-3.jpg'],
  ['mcp1.png', 'mcp-1.jpg'],
  ['mcp2.png', 'mcp-2.jpg'],
  ['mcp3.png', 'mcp-3.jpg'],
  ['tool1.png', 'tool-call-1.jpg'],
  ['tool2.png', 'tool-call-2.jpg'],
  ['tool3.png', 'tool-call-3.jpg'],
  ['rag1.png', 'rag-1.jpg'],
  ['rag2.png', 'rag-2.jpg'],
  ['rag3.png', 'rag-3.jpg'],
  ['context1.png', 'context-1.jpg'],
  ['context2.png', 'context-2.jpg'],
  ['context3.png', 'context-3.jpg']
]);

async function validateSource(sourcePath, sourceName) {
  const metadata = await sharp(sourcePath).metadata();
  if (metadata.width !== 1086 || metadata.height !== 1448) {
    throw new Error(`UNEXPECTED_POSTER_SIZE:${sourceName}:${metadata.width}x${metadata.height}`);
  }
}

async function main() {
  const inputRoot = path.resolve(sourceRoot);
  const outputRoot = path.resolve(__dirname, '../assets/ai-column/posters');
  await fs.mkdir(outputRoot, { recursive: true });

  let totalBytes = 0;
  for (const [sourceName, outputName] of POSTERS) {
    const sourcePath = path.join(inputRoot, sourceName);
    const outputPath = path.join(outputRoot, outputName);
    await validateSource(sourcePath, sourceName);
    await sharp(sourcePath)
      .resize({ width: 640, withoutEnlargement: true })
      .jpeg({
        quality: 50,
        progressive: false,
        chromaSubsampling: '4:2:0',
        mozjpeg: false
      })
      .toFile(outputPath);
    const { size } = await fs.stat(outputPath);
    totalBytes += size;
    console.log(`${outputName}\t${size}`);
  }
  console.log(`IMPORTED\t${POSTERS.length}\t${totalBytes}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
