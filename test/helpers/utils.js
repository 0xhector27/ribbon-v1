const { encodeCall } = require("@openzeppelin/upgrades");
const { ethers, artifacts } = require("hardhat");
const { BigNumber, constants } = ethers;
const { parseEther } = ethers.utils;

module.exports = {
  getDefaultArgs,
  deployProxy,
  wmul,
  wdiv,
  parseLog,
};

async function deployProxy(
  logicContractName,
  adminSigner,
  initializeTypes,
  initializeArgs,
  factoryOptions
) {
  const AdminUpgradeabilityProxy = await ethers.getContractFactory(
    "AdminUpgradeabilityProxy",
    adminSigner
  );
  const LogicContract = await ethers.getContractFactory(
    logicContractName,
    factoryOptions || {}
  );
  const logic = await LogicContract.deploy();

  const initBytes = encodeCall("initialize", initializeTypes, initializeArgs);
  const proxy = await AdminUpgradeabilityProxy.deploy(
    logic.address,
    adminSigner.address,
    initBytes
  );
  return await ethers.getContractAt(logicContractName, proxy.address);
}

const CHI_ADDRESS = "0x0000000000004946c0e9F43F4Dee607b0eF1fA1c";
const HEGIC_ETH_OPTIONS = "0xEfC0eEAdC1132A12c9487d800112693bf49EcfA2";
const HEGIC_WBTC_OPTIONS = "0x3961245DB602eD7c03eECcda33eA3846bD8723BD";
const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const ETH_ADDRESS = constants.AddressZero;

const ZERO_EX_EXCHANGE = "0x61935CbDd02287B511119DDb11Aeb42F1593b7Ef";
const GAMMA_CONTROLLER = "0x4ccc2339F87F6c59c6893E1A678c2266cA58dC72";
const GAMMA_ORACLE = "0xc497f40D1B7db6FA5017373f1a0Ec6d53126Da23";
const OTOKEN_FACTORY = "0x7C06792Af1632E77cb27a558Dc0885338F4Bdf8E";
const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

let factory, hegicAdapter, opynV1Adapter, gammaAdapter;

async function getDefaultArgs() {
  // ensure we just return the cached instances instead of re-initializing everything
  if (
    factory &&
    hegicAdapter &&
    opynV1Adapter &&
    gammaAdapter &&
    mockGammaController
  ) {
    return {
      factory,
      hegicAdapter,
      opynV1Adapter,
      gammaAdapter,
      mockGammaController,
    };
  }

  const [adminSigner, ownerSigner] = await ethers.getSigners();
  const admin = adminSigner.address;
  const owner = ownerSigner.address;

  const HegicAdapter = await ethers.getContractFactory(
    "HegicAdapter",
    ownerSigner
  );
  const GammaAdapter = await ethers.getContractFactory(
    "GammaAdapter",
    ownerSigner
  );
  const MockGammaController = await ethers.getContractFactory(
    "MockGammaController",
    ownerSigner
  );
  const ProtocolAdapter = await ethers.getContractFactory("ProtocolAdapter");

  factory = (
    await deployProxy(
      "RibbonFactory",
      adminSigner,
      ["address", "address"],
      [owner, admin]
    )
  ).connect(ownerSigner);

  hegicAdapter = await HegicAdapter.deploy(
    HEGIC_ETH_OPTIONS,
    HEGIC_WBTC_OPTIONS,
    ETH_ADDRESS,
    WBTC_ADDRESS
  );

  mockGammaController = await MockGammaController.deploy(
    GAMMA_ORACLE,
    UNISWAP_ROUTER,
    WETH_ADDRESS
  );

  let mockGammaAdapter = await GammaAdapter.deploy(
    OTOKEN_FACTORY,
    mockGammaController.address,
    WETH_ADDRESS,
    ZERO_EX_EXCHANGE,
    UNISWAP_ROUTER
  );

  let gammaAdapter = await GammaAdapter.deploy(
    OTOKEN_FACTORY,
    GAMMA_CONTROLLER,
    WETH_ADDRESS,
    ZERO_EX_EXCHANGE,
    UNISWAP_ROUTER
  );

  // await mintGasTokens(admin, factory.address);

  await factory.setAdapter("HEGIC", hegicAdapter.address, { from: owner });
  await factory.setAdapter("OPYN_GAMMA", gammaAdapter.address, { from: owner });

  const protocolAdapterLib = await ProtocolAdapter.deploy();

  return {
    factory,
    hegicAdapter,
    mockGammaAdapter,
    gammaAdapter,
    mockGammaController,
    protocolAdapterLib,
  };
}

async function mintGasTokens(minter, factoryAddress) {
  const chiToken = await ChiToken.at(CHI_ADDRESS);
  const mintAmount = 200;
  const receipt = await chiToken.mint(mintAmount, {
    from: minter,
    gas: 8000000,
  });
  await chiToken.transfer(factoryAddress, mintAmount, {
    from: minter,
  });
}

function wdiv(x, y) {
  return x
    .mul(parseEther("1"))
    .add(y.div(BigNumber.from("2")))
    .div(y);
}

function wmul(x, y) {
  return x
    .mul(y)
    .add(parseEther("1").div(BigNumber.from("2")))
    .div(parseEther("1"));
}

async function parseLog(contractName, log) {
  if (typeof contractName !== "string") {
    throw new Error("contractName must be string");
  }
  const abi = (await artifacts.readArtifact(contractName)).abi;
  const iface = new ethers.utils.Interface(abi);
  const event = iface.parseLog(log);
  return event;
}
