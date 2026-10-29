const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

function compile() {
  const filename = 'AuvenProofRegistry.sol';
  const source = fs.readFileSync(path.join(__dirname, '..', 'contracts', filename), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [filename]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
  const contract = output.contracts?.[filename]?.AuvenProofRegistry;
  if (!contract?.evm?.bytecode?.object) throw new Error('Registry bytecode missing');
  return { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object };
}

if (require.main === module) {
  const artifact = compile();
  console.log(`AuvenProofRegistry compiled with solc ${solc.version()}; bytecode ${artifact.bytecode.length / 2 - 1} bytes`);
}

module.exports = { compile };
