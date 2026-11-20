// Sandbox page: connect your own wallet, sign and send the HamDailyRun deploy transaction.
// No private key is ever read or stored here. The wallet extension signs; this page only builds the transaction.
import { BrowserProvider, Contract, ContractFactory, parseEther, isAddress, getAddress } from 'ethers';
import { CHAINS } from './config.js';
import artifact from './contract-artifact.json';
import nftArtifact from './nft-artifact.json';
import passArtifact from './pass-art-artifact.json';
import { pickProvider } from './wallet.js';

const $ = (id) => document.getElementById(id);
const say = (el, msg, kind = '') => { el.textContent = msg; el.className = 'status ' + kind; };
const net = () => CHAINS[$('netSel').value];
const isMainnet = () => $('netSel').value !== 'aurora-testnet';

let signer = null, account = null;

function onChainChange() {
  signer = null; account = null;
  $('dot').classList.remove('on');
  $('netLabel').textContent = 'Not connected';
  $('connectBtn').textContent = 'Connect wallet'; $('connectBtn').disabled = false;
  $('mainnetWarn').textContent = isMainnet() ? `This is ${net().name}, a live mainnet. Deploying here costs real ETH for gas, and the pot it starts collecting is real money.` : '';
  $('confirmRow').classList.toggle('hidden', !isMainnet());
  $('mainnetConfirm').checked = false;
  refreshDeployButton();
}
function refreshDeployButton() {
  const ready = !!signer && (!isMainnet() || $('mainnetConfirm').checked);
  $('deployBtn').disabled = !ready;
  $('deployBtn').textContent = !signer ? 'Connect your wallet first' : (isMainnet() && !$('mainnetConfirm').checked) ? 'Check the box above to continue' : 'Deploy HamDailyRun';
  $('deployNftBtn').disabled = !ready;
  $('deployNftBtn').textContent = !signer ? 'Connect your wallet first' : (isMainnet() && !$('mainnetConfirm').checked) ? 'Check the box above to continue' : 'Deploy HamPowerUp';
}

async function connect() {
  const NET = net(), HEX = '0x' + NET.id.toString(16);
  try {
    say($('walletStatus'), 'Connecting…');
    const eth = await pickProvider();
    let provider = new BrowserProvider(eth, 'any');
    const [acc] = await provider.send('eth_requestAccounts', []);
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: HEX }]);
    } catch (e) {
      if (e?.error?.code === 4902 || e?.code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || '')) {
        await provider.send('wallet_addEthereumChain', [{ chainId: HEX, chainName: NET.name, rpcUrls: [NET.rpc], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [NET.explorer] }]);
      } else throw e;
    }
    provider = new BrowserProvider(eth, 'any');
    signer = await provider.getSigner();
    account = getAddress(acc);
    $('dot').classList.add('on');
    $('netLabel').textContent = `${account.slice(0, 6)}…${account.slice(-4)} on ${NET.name}`;
    $('connectBtn').textContent = 'Connected';
    $('connectBtn').disabled = true;
    if (!$('owner').value) $('owner').value = account;
    if (!$('treasury').value) $('treasury').value = account;
    refreshDeployButton();
    say($('walletStatus'), '', '');
  } catch (e) {
    say($('walletStatus'), e?.code === 'ACTION_REJECTED' || e?.code === 4001 ? 'You declined the connection in your wallet.' : (e?.shortMessage || e?.message || String(e)), 'bad');
  }
}

async function deploy() {
  const addr = (id) => { const v = $(id).value.trim(); if (!isAddress(v)) throw new Error(`"${$(id).previousElementSibling.textContent}" is not a valid address.`); return getAddress(v); };
  const num = (id) => { const v = Number($(id).value); if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`"${$(id).previousElementSibling.textContent}" must be a whole number from 0 to 255.`); return v; };
  if (isMainnet() && !$('mainnetConfirm').checked) return; // belt and braces - the button is disabled for this already
  const NET = net();
  $('deployBtn').disabled = true;
  try {
    const owner = addr('owner'), referee = addr('referee'), treasury = addr('treasury');
    const fee = parseEther(String($('fee').value || '0'));
    const cfg = [num('mazeSize'), num('cellSize'), num('sentries'), num('sentryHealth'), num('sentryDamage'), num('playerHealth'), num('magSize'), num('loops')];
    say($('deployStatus'), 'Confirm the deployment in your wallet…');
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const contract = await factory.deploy(owner, referee, treasury, fee, cfg);
    say($('deployStatus'), 'Waiting for it to be mined…');
    await contract.waitForDeployment();
    const a = await contract.getAddress();
    const tx = contract.deploymentTransaction();
    say($('deployStatus'), 'Deployed.', 'ok');
    $('addrOut').textContent = `${a} on ${NET.name}`;
    $('explorerLink').innerHTML = tx ? `<a href="${NET.explorer}/tx/${tx.hash}" target="_blank" rel="noopener">View the deploy transaction</a>` : '';
    $('result').classList.remove('hidden');
  } catch (e) {
    say($('deployStatus'), e?.code === 'ACTION_REJECTED' || e?.code === 4001 ? 'You declined the transaction in your wallet.' : (e?.shortMessage || e?.reason || e?.message || String(e)), 'bad');
  } finally {
    refreshDeployButton();
  }
}

async function deployNft() {
  if (isMainnet() && !$('mainnetConfirm').checked) return; // belt and braces - the button is disabled for this already
  const NET = net();
  $('deployNftBtn').disabled = true;
  try {
    say($('deployNftStatus'), 'Confirm the deployment in your wallet…');
    const factory = new ContractFactory(nftArtifact.abi, nftArtifact.bytecode, signer);
    const contract = await factory.deploy();
    say($('deployNftStatus'), 'Waiting for it to be mined…');
    await contract.waitForDeployment();
    const a = await contract.getAddress();
    const tx = contract.deploymentTransaction();
    say($('deployNftStatus'), 'Deployed.', 'ok');
    $('nftAddrOut').textContent = `${a} on ${NET.name}`;
    $('nftExplorerLink').innerHTML = tx ? `<a href="${NET.explorer}/tx/${tx.hash}" target="_blank" rel="noopener">View the deploy transaction</a>` : '';
    $('nftResult').classList.remove('hidden');
  } catch (e) {
    say($('deployNftStatus'), e?.code === 'ACTION_REJECTED' || e?.code === 4001 ? 'You declined the transaction in your wallet.' : (e?.shortMessage || e?.reason || e?.message || String(e)), 'bad');
  } finally {
    refreshDeployButton();
  }
}

$('netSel').addEventListener('change', onChainChange);
$('mainnetConfirm').addEventListener('change', refreshDeployButton);
$('connectBtn').addEventListener('click', connect);
$('deployBtn').addEventListener('click', deploy);
$('deployNftBtn').addEventListener('click', deployNft);
onChainChange();

// ── FundingWorks pass art, on Ethereum mainnet (its own wallet connection: the game's chain is separate) ──
let passSigner = null;
const ETHERSCAN = 'https://etherscan.io';
const declined = (e) => e?.code === 'ACTION_REJECTED' || e?.code === 4001;
function refreshPass() {
  const ok = !!passSigner && $('passConfirm').checked;
  $('deployPassBtn').disabled = !ok;
  $('deployPassBtn').textContent = !passSigner ? 'Connect your wallet first' : !$('passConfirm').checked ? 'Check the box above to continue' : 'Deploy HamPassArt on Ethereum';
  $('setCampaignBtn').disabled = !passSigner;
  $('setCampaignBtn').textContent = !passSigner ? 'Connect your wallet first' : 'Point the art at the campaign';
}
async function passConnect() {
  try {
    say($('passWalletStatus'), 'Connecting…');
    const eth = await pickProvider();
    let provider = new BrowserProvider(eth, 'any');
    await provider.send('eth_requestAccounts', []);
    await provider.send('wallet_switchEthereumChain', [{ chainId: '0x1' }]);
    provider = new BrowserProvider(eth, 'any');
    if (Number((await provider.getNetwork()).chainId) !== 1) throw new Error('Switch your wallet to Ethereum mainnet.');
    passSigner = await provider.getSigner();
    const a = await passSigner.getAddress();
    say($('passWalletStatus'), 'Connected: ' + a.slice(0, 6) + '…' + a.slice(-4) + ' on Ethereum mainnet', 'ok');
    $('passConnectBtn').disabled = true;
  } catch (e) {
    say($('passWalletStatus'), declined(e) ? 'You declined in your wallet.' : (e?.shortMessage || e?.message || String(e)), 'bad');
  }
  refreshPass();
}
async function deployPass() {
  if (!passSigner || !$('passConfirm').checked) return;
  $('deployPassBtn').disabled = true;
  try {
    say($('deployPassStatus'), 'Confirm the deployment in your wallet…');
    const c = await new ContractFactory(passArtifact.abi, passArtifact.bytecode, passSigner).deploy();
    say($('deployPassStatus'), 'Waiting for it to be mined…');
    await c.waitForDeployment();
    const a = await c.getAddress(), tx = c.deploymentTransaction();
    say($('deployPassStatus'), 'Deployed.', 'ok');
    $('passAddrOut').textContent = a;
    $('passArtAddr').value = a;
    $('passExplorerLink').innerHTML = tx ? '<a href="' + ETHERSCAN + '/tx/' + tx.hash + '" target="_blank" rel="noopener">View the deploy transaction</a>' : '';
    $('passResult').classList.remove('hidden');
  } catch (e) {
    say($('deployPassStatus'), declined(e) ? 'You declined the transaction in your wallet.' : (e?.shortMessage || e?.reason || e?.message || String(e)), 'bad');
  } finally { refreshPass(); }
}
async function setCampaign() {
  try {
    const art = $('passArtAddr').value.trim(), camp = $('passCampaign').value.trim();
    if (!isAddress(art)) throw new Error('The pass art address is not valid.');
    if (!isAddress(camp)) throw new Error('The campaign address is not valid.');
    $('setCampaignBtn').disabled = true;
    say($('setCampaignStatus'), 'Confirm in your wallet…');
    const tx = await new Contract(getAddress(art), passArtifact.abi, passSigner).setCampaign(getAddress(camp));
    say($('setCampaignStatus'), 'Waiting for it to be mined…');
    await tx.wait();
    say($('setCampaignStatus'), 'Done: the passes now show their stream.', 'ok');
  } catch (e) {
    say($('setCampaignStatus'), declined(e) ? 'You declined the transaction in your wallet.' : (e?.shortMessage || e?.reason || e?.message || String(e)), 'bad');
  } finally { refreshPass(); }
}
$('passConnectBtn').addEventListener('click', passConnect);
$('passConfirm').addEventListener('change', refreshPass);
$('deployPassBtn').addEventListener('click', deployPass);
$('setCampaignBtn').addEventListener('click', setCampaign);
refreshPass();
