const { accounts, contract } = require("@openzeppelin/test-environment");
const { assert } = require("chai");

const {
  ZERO_ADDRESS,
  expectEvent,
  expectRevert,
} = require("@openzeppelin/test-helpers");
const { getDefaultArgs } = require("./utils.js");
const { encodeCall } = require("@openzeppelin/upgrades");

const Instrument = contract.fromArtifact("TwinYield");

const newInstrumentTypes = [
  "address",
  "string",
  "string",
  "uint256",
  "uint256",
  "uint256",
  "address",
  "address",
  "address",
  "address",
  "address",
];

describe("DojimaFactory", function () {
  const [admin, owner, user] = accounts;

  before(async function () {
    const {
      factory,
      colAsset,
      targetAsset,
      instrument,
      dToken,
      args,
      liquidatorProxy,
      dataProvider,
      instrumentLogic,
      bFactory,
      paymentToken,
    } = await getDefaultArgs(admin, owner, user);

    this.factory = factory;
    this.collateralAsset = colAsset;
    this.targetAsset = targetAsset;
    this.contract = instrument;
    this.dToken = dToken;
    this.liquidatorProxy = liquidatorProxy;
    this.dataProvider = dataProvider;
    this.instrumentLogic = instrumentLogic;
    this.bFactory = bFactory;
    this.paymentToken = paymentToken;
    this.args = args;

    this.contractAddress = instrument.address;
    this.dTokenAddress = dToken.address;
  });

  it("initializes factory correctly", async function () {
    assert.equal(
      await this.factory.liquidatorProxy(),
      this.liquidatorProxy.address
    );
    assert.equal(await this.factory.dataProvider(), this.dataProvider.address);
    assert.equal(await this.factory.owner(), owner);
  });

  it("initializes contract correctly", async function () {
    assert.equal(await this.contract.name(), this.args.name);
    assert.equal(await this.contract.symbol(), this.args.symbol);
    assert.equal((await this.contract.expiry()).toString(), this.args.expiry);
    assert.equal(
      (await this.contract.collateralizationRatio()).toString(),
      this.args.colRatio
    );
    assert.equal(
      await this.contract.collateralAsset(),
      this.collateralAsset.address
    );
    assert.equal(await this.contract.targetAsset(), this.targetAsset.address);
    assert.equal(await this.contract.expired(), false);
    assert.equal(await this.contract.balancerDToken(), this.dTokenAddress);
    assert.equal(
      await this.contract.balancerPaymentToken(),
      this.paymentToken.address
    );
    assert.notEqual(await this.contract.balancerPool(), ZERO_ADDRESS);
  });

  it("adds instrument to mapping", async function () {
    assert.equal(
      await this.factory.getInstrument(this.args.name),
      this.contract.address
    );
  });

  it("creates dToken correctly", async function () {
    assert.equal(await this.dToken.name(), this.args.name);
    assert.equal(await this.dToken.symbol(), this.args.symbol);
  });

  it("reverts if instrument already exists", async function () {
    const initData = encodeCall("initialize", newInstrumentTypes, [
      this.dataProvider.address,
      this.args.name,
      this.args.symbol,
      this.args.expiry.toString(),
      this.args.strikePrice.toString(),
      this.args.colRatio.toString(),
      this.collateralAsset.address,
      this.targetAsset.address,
      this.paymentToken.address,
      this.liquidatorProxy.address,
      this.bFactory.address,
    ]);

    const newContract = this.factory.newInstrument(
      this.instrumentLogic.address,
      initData,
      { from: owner }
    );

    expectRevert(newContract, "Instrument already exists");
  });

  it("reverts if any account other than owner calls", async function () {
    const initData = encodeCall("initialize", newInstrumentTypes, [
      this.dataProvider.address,
      "test",
      "test",
      "32503680000",
      "42000000000",
      "1",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000001",
      this.liquidatorProxy.address,
      "0x0000000000000000000000000000000000000002",
    ]);

    const tx = this.factory.newInstrument(
      this.instrumentLogic.address,
      initData,
      { from: user }
    );
    await expectRevert(tx, "Only owner");
  });

  it("emits event correctly", async function () {
    const name = "test";

    const initData = encodeCall("initialize", newInstrumentTypes, [
      this.dataProvider.address,
      name,
      "test",
      "32503680000",
      "42000000000",
      "1",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000001",
      this.liquidatorProxy.address,
      this.bFactory.address,
    ]);

    const res = await this.factory.newInstrument(
      this.instrumentLogic.address,
      initData,
      { from: owner }
    );

    const instrument = await Instrument.at(res.logs[1].args.instrumentAddress);
    const dToken = await instrument.dToken();

    expectEvent(res, "ProxyCreated", {
      logic: this.instrumentLogic.address,
      proxyAddress: instrument.address,
    });

    expectEvent(res, "InstrumentCreated", {
      name: name,
      instrumentAddress: instrument.address,
      dTokenAddress: dToken,
    });
  });
});
