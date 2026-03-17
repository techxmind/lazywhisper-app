import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Get version from package.json
const pkgPath = join(process.cwd(), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

// Update tauri.conf.json
const tauriConfPath = join(process.cwd(), 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// Update Cargo.toml
const cargoTomlPath = join(process.cwd(), 'src-tauri', 'Cargo.toml');
let cargoToml = readFileSync(cargoTomlPath, 'utf8');
cargoToml = cargoToml.replace(/^version = ".*"/m, `version = "${version}"`);
writeFileSync(cargoTomlPath, cargoToml);

console.log(`✅ Synchronized version ${version} to Tauri and Cargo configurations.`);
