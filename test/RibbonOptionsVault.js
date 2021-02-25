const { expect, assert } = require("chai");
const { BigNumber } = require("ethers");
const { parseUnits } = require("ethers/lib/utils");
const { ethers } = require("hardhat");
const { signOrderForSwap } = require("./helpers/signature");
const { provider, getContractAt } = ethers;
const { parseEther } = ethers.utils;

const time = require("./helpers/time");
const { deployProxy, getDefaultArgs, wmul } = require("./helpers/utils");

let owner, user;
let userSigner, ownerSigner, managerSigner, counterpartySigner;

const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const MARGIN_POOL = "0x5934807cC0654d46755eBd2848840b616256C6Ef";
const SWAP_ADDRESS = "0x4572f2554421Bd64Bef1c22c8a81840E8D496BeA";

const LOCKED_RATIO = parseEther("0.9");
const WITHDRAWAL_FEE = parseEther("0.005");
const gasPrice = parseUnits("10", "gwei");

describe("RibbonETHCoveredCall", () => {
  let initSnapshotId;

  before(async function () {
    initSnapshotId = await time.takeSnapshot();

    [
      adminSigner,
      ownerSigner,
      userSigner,
      managerSigner,
      counterpartySigner,
    ] = await ethers.getSigners();
    owner = ownerSigner.address;
    user = userSigner.address;
    manager = managerSigner.address;
    counterparty = counterpartySigner.address;

    this.managerWallet = ethers.Wallet.fromMnemonic(
      process.env.TEST_MNEMONIC,
      "m/44'/60'/0'/0/3"
    );

    const {
      factory,
      protocolAdapterLib,
      gammaAdapter,
    } = await getDefaultArgs();
    await factory.setAdapter("OPYN_GAMMA", gammaAdapter.address);

    const initializeTypes = ["address", "address"];
    const initializeArgs = [owner, factory.address];

    this.vault = (
      await deployProxy(
        "RibbonETHCoveredCall",
        adminSigner,
        initializeTypes,
        initializeArgs,
        {
          libraries: {
            ProtocolAdapter: protocolAdapterLib.address,
          },
        }
      )
    ).connect(userSigner);

    await this.vault.connect(ownerSigner).setManager(manager);

    this.optionTerms = [
      WETH_ADDRESS,
      USDC_ADDRESS,
      WETH_ADDRESS,
      "1614326400",
      parseEther("960"),
      2,
    ];

    this.oTokenAddress = "0x3cF86d40988309AF3b90C14544E1BB0673BFd439";

    this.oToken = await getContractAt("IERC20", this.oTokenAddress);

    this.weth = await getContractAt("IWETH", WETH_ADDRESS);

    this.airswap = await getContractAt("ISwap", SWAP_ADDRESS);
  });

  after(async () => {
    await time.revertToSnapShot(initSnapshotId);
  });

  describe("#name", () => {
    it("returns the name", async function () {
      assert.equal(await this.vault.name(), "Ribbon ETH Covered Call Vault");
    });
  });

  describe("#symbol", () => {
    it("returns the symbol", async function () {
      assert.equal(await this.vault.symbol(), "rETH-COVCALL");
    });
  });

  describe("#asset", () => {
    it("returns the asset", async function () {
      assert.equal(await this.vault.asset(), WETH_ADDRESS);
    });
  });

  describe("#exchangeMechanism", () => {
    it("returns the exchange mechanism", async function () {
      assert.equal(await this.vault.exchangeMechanism(), 1);
    });
  });

  describe("#owner", () => {
    it("returns the owner", async function () {
      assert.equal(await this.vault.owner(), owner);
    });
  });

  describe("#setManager", () => {
    time.revertToSnapshotAfterTest();

    it("reverts when not owner call", async function () {
      await expect(this.vault.setManager(manager)).to.be.revertedWith(
        "caller is not the owner"
      );
    });

    it("sets the first manager", async function () {
      await this.vault.connect(ownerSigner).setManager(manager);
      assert.equal(await this.vault.manager(), manager);
      assert.isTrue(
        await this.airswap.signerAuthorizations(this.vault.address, manager)
      );
    });

    it("changes the manager", async function () {
      await this.vault.connect(ownerSigner).setManager(owner);
      await this.vault.connect(ownerSigner).setManager(manager);
      assert.equal(await this.vault.manager(), manager);
      assert.isFalse(
        await this.airswap.signerAuthorizations(this.vault.address, owner)
      );
      assert.isTrue(
        await this.airswap.signerAuthorizations(this.vault.address, manager)
      );
    });
  });

  describe("#depositETH", () => {
    time.revertToSnapshotAfterEach();

    it("deposits successfully", async function () {
      const depositAmount = parseEther("1");
      const res = await this.vault.depositETH({ value: depositAmount });
      const receipt = await res.wait();

      assert.isAtMost(receipt.gasUsed.toNumber(), 150000);

      assert.equal((await this.vault.totalSupply()).toString(), depositAmount);
      assert.equal(
        (await this.vault.balanceOf(user)).toString(),
        depositAmount
      );
    });

    it("returns the correct number of shares back", async function () {
      // first user gets 3 shares
      await this.vault
        .connect(userSigner)
        .depositETH({ value: parseEther("3") });
      assert.equal(
        (await this.vault.balanceOf(user)).toString(),
        parseEther("3")
      );

      // simulate the vault accumulating more WETH
      await this.weth.connect(userSigner).deposit({ value: parseEther("1") });
      await this.weth
        .connect(userSigner)
        .transfer(this.vault.address, parseEther("1"));

      assert.equal(
        (await this.vault.totalBalance()).toString(),
        parseEther("4")
      );

      // formula:
      // (depositAmount * totalSupply) / total
      // (1 * 3) / 4 = 0.75 shares
      await this.vault
        .connect(counterpartySigner)
        .depositETH({ value: parseEther("1") });
      assert.equal(
        (await this.vault.balanceOf(counterparty)).toString(),
        parseEther("0.75")
      );
    });

    it("accounts for the amounts that are locked", async function () {
      // first user gets 3 shares
      await this.vault
        .connect(userSigner)
        .depositETH({ value: parseEther("3") });

      // simulate the vault accumulating more WETH
      await this.weth.connect(userSigner).deposit({ value: parseEther("1") });
      await this.weth
        .connect(userSigner)
        .transfer(this.vault.address, parseEther("1"));

      await this.vault.connect(managerSigner).writeOptions(this.optionTerms);

      // formula:
      // (depositAmount * totalSupply) / total
      // (1 * 3) / 4 = 0.75 shares
      await this.vault
        .connect(counterpartySigner)
        .depositETH({ value: parseEther("1") });
      assert.equal(
        (await this.vault.balanceOf(counterparty)).toString(),
        parseEther("0.75")
      );
    });
  });

  describe("signing an order message", () => {
    it("signs an order message", async function () {
      const sellToken = this.oTokenAddress;
      const buyToken = WETH_ADDRESS;
      const buyAmount = parseEther("0.1");
      const sellAmount = BigNumber.from("100000000");

      const signedOrder = await signOrderForSwap({
        vaultAddress: this.vault.address,
        counterpartyAddress: counterparty,
        signerPrivateKey: this.managerWallet.privateKey,
        sellToken,
        buyToken,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
      });

      const { signatory, validator } = signedOrder.signature;
      const {
        wallet: signerWallet,
        token: signerToken,
        amount: signerAmount,
      } = signedOrder.signer;
      const {
        wallet: senderWallet,
        token: senderToken,
        amount: senderAmount,
      } = signedOrder.sender;
      assert.equal(ethers.utils.getAddress(signatory), manager);
      assert.equal(ethers.utils.getAddress(validator), SWAP_ADDRESS);
      assert.equal(ethers.utils.getAddress(signerWallet), this.vault.address);
      assert.equal(ethers.utils.getAddress(signerToken), this.oTokenAddress);
      assert.equal(ethers.utils.getAddress(senderWallet), counterparty);
      assert.equal(ethers.utils.getAddress(senderToken), WETH_ADDRESS);
      assert.equal(signerAmount, sellAmount);
      assert.equal(senderAmount, buyAmount.toString());
    });
  });

  describe("#writeOptions", () => {
    time.revertToSnapshotAfterEach(async function () {
      this.depositAmount = parseEther("1");
      this.expectedMintAmount = BigNumber.from("90000000");
      await this.vault.depositETH({ value: this.depositAmount });
    });

    it("reverts when not called with manager", async function () {
      await expect(
        this.vault
          .connect(userSigner)
          .writeOptions(this.optionTerms, { from: user })
      ).to.be.revertedWith("Only manager");
    });

    it("mints oTokens and deposits collateral into vault", async function () {
      const lockedAmount = wmul(this.depositAmount, LOCKED_RATIO);
      const availableAmount = wmul(
        this.depositAmount,
        parseEther("1").sub(LOCKED_RATIO)
      );

      const startMarginBalance = await this.weth.balanceOf(MARGIN_POOL);

      const res = await this.vault
        .connect(managerSigner)
        .writeOptions(this.optionTerms, { from: manager });

      expect(res)
        .to.emit(this.vault, "WriteOptions")
        .withArgs(manager, this.oTokenAddress, lockedAmount);

      assert.equal((await this.vault.lockedAmount()).toString(), lockedAmount);

      assert.equal(
        (await this.vault.availableToWithdraw()).toString(),
        availableAmount
      );

      assert.equal(
        (await this.weth.balanceOf(MARGIN_POOL))
          .sub(startMarginBalance)
          .toString(),
        lockedAmount.toString()
      );

      assert.deepEqual(
        await this.oToken.balanceOf(this.vault.address),
        this.expectedMintAmount
      );

      assert.equal(await this.vault.currentOption(), this.oTokenAddress);

      assert.deepEqual(
        await this.oToken.allowance(this.vault.address, SWAP_ADDRESS),
        this.expectedMintAmount
      );
    });
  });

  describe("Swapping with counterparty", () => {
    time.revertToSnapshotAfterEach(async function () {
      this.premium = parseEther("0.1");
      this.depositAmount = parseEther("1");
      this.sellAmount = BigNumber.from("90000000");

      const weth = this.weth.connect(counterpartySigner);
      await weth.deposit({ value: this.premium });
      await weth.approve(SWAP_ADDRESS, this.premium);

      await this.vault.depositETH({ value: this.depositAmount });
      await this.vault
        .connect(managerSigner)
        .writeOptions(this.optionTerms, { from: manager });
    });

    it("completes the trade with the counterparty", async function () {
      const startSellTokenBalance = await this.oToken.balanceOf(
        this.vault.address
      );
      const startBuyTokenBalance = await this.weth.balanceOf(
        this.vault.address
      );

      const signedOrder = await signOrderForSwap({
        vaultAddress: this.vault.address,
        counterpartyAddress: counterparty,
        signerPrivateKey: this.managerWallet.privateKey,
        sellToken: this.oTokenAddress,
        buyToken: WETH_ADDRESS,
        sellAmount: this.sellAmount.toString(),
        buyAmount: this.premium.toString(),
      });

      const res = await this.airswap
        .connect(counterpartySigner)
        .swap(signedOrder);

      expect(res)
        .to.emit(this.oToken, "Transfer")
        .withArgs(this.vault.address, counterparty, this.sellAmount);

      const wethERC20 = await getContractAt("IERC20", this.weth.address);

      expect(res)
        .to.emit(wethERC20, "Transfer")
        .withArgs(counterparty, this.vault.address, this.premium);

      assert.deepEqual(
        await this.oToken.balanceOf(this.vault.address),
        startSellTokenBalance.sub(this.sellAmount)
      );
      assert.deepEqual(
        await this.weth.balanceOf(this.vault.address),
        startBuyTokenBalance.add(this.premium)
      );
    });
  });

  describe("#availableToWithdraw", () => {
    time.revertToSnapshotAfterEach(async function () {
      this.depositAmount = parseEther("1");

      await this.vault.depositETH({ value: this.depositAmount });

      assert.equal(
        (await this.vault.totalSupply()).toString(),
        this.depositAmount
      );

      await this.vault
        .connect(managerSigner)
        .writeOptions(this.optionTerms, { from: manager });
    });

    it("returns the 10% reserve amount", async function () {
      assert.equal(
        (await this.vault.availableToWithdraw()).toString(),
        wmul(this.depositAmount, parseEther("0.1")).toString()
      );
    });

    it("returns the free balance - locked, if free > locked", async function () {
      await this.vault.availableToWithdraw();

      await this.vault.depositETH({ value: parseEther("10") });

      const freeAmount = wmul(
        parseEther("10").add(this.depositAmount),
        parseEther("0.1")
      );

      assert.equal(
        (await this.vault.availableToWithdraw()).toString(),
        freeAmount
      );
    });
  });

  describe("#withdraw", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when withdrawing more than 10%", async function () {
      await this.vault.depositETH({ value: parseEther("1") });

      await expect(this.vault.withdrawETH(parseEther("1"))).to.be.revertedWith(
        "Cannot withdraw more than available"
      );
    });

    it("should withdraw funds, leaving behind withdrawal fee if <10%", async function () {
      await this.vault.depositETH({ value: parseEther("1") });
      const startETHBalance = await provider.getBalance(user);

      const res = await this.vault.withdrawETH(parseEther("0.1"), { gasPrice });
      const receipt = await res.wait();
      const gasFee = gasPrice.mul(receipt.gasUsed);

      // Fee is left behind
      assert.equal(
        (await this.weth.balanceOf(this.vault.address)).toString(),
        parseEther("0.901").toString()
      );

      assert.equal(
        (await provider.getBalance(user))
          .add(gasFee)
          .sub(startETHBalance)
          .toString(),
        parseEther("0.099").toString()
      );

      // Share amount is burned
      assert.equal(
        (await this.vault.balanceOf(user)).toString(),
        parseEther("0.9")
      );

      assert.equal(
        (await this.vault.totalSupply()).toString(),
        parseEther("0.9")
      );
    });

    it("should withdraw funds up to 10% of pool", async function () {
      await this.vault.depositETH({ value: parseEther("1") });

      // simulate the vault accumulating more WETH
      await this.weth.connect(userSigner).deposit({ value: parseEther("1") });
      await this.weth
        .connect(userSigner)
        .transfer(this.vault.address, parseEther("1"));

      assert.equal(
        (await this.vault.availableToWithdraw()).toString(),
        parseEther("0.2")
      );

      // reverts when withdrawing >0.2 ETH
      await expect(
        this.vault.withdrawETH(parseEther("0.2").add(BigNumber.from("1")))
      ).to.be.revertedWith("Cannot withdraw more than available");

      await this.vault.withdrawETH(parseEther("0.1"));
    });

    it("should only withdraw original deposit amount minus fees if vault doesn't expand", async function () {
      await this.vault.depositETH({ value: parseEther("1") });

      const startETHBalance = await provider.getBalance(user);

      await this.vault
        .connect(counterpartySigner)
        .depositETH({ value: parseEther("10") });

      // As the pool expands, using 1 pool share will redeem more amount of collateral
      const res = await this.vault.withdrawETH(parseEther("1"), { gasPrice });
      const receipt = await res.wait();

      // 0.99 ETH because 1% paid to fees
      const gasUsed = receipt.gasUsed.mul(gasPrice);
      assert.equal(
        (await provider.getBalance(user))
          .add(gasUsed)
          .sub(startETHBalance)
          .toString(),
        parseEther("0.99").toString()
      );
    });

    it("should withdraw more collateral when the balance increases", async function () {
      await this.vault.depositETH({ value: parseEther("1") });

      const startETHBalance = await provider.getBalance(user);

      await this.vault
        .connect(counterpartySigner)
        .depositETH({ value: parseEther("10") });

      await this.weth
        .connect(counterpartySigner)
        .deposit({ value: parseEther("10") });
      await this.weth
        .connect(counterpartySigner)
        .transfer(this.vault.address, parseEther("10"));

      // As the pool expands, using 1 pool share will redeem more amount of collateral
      const res = await this.vault.withdrawETH(parseEther("1"), { gasPrice });
      const receipt = await res.wait();

      const gasUsed = receipt.gasUsed.mul(gasPrice);
      assert.equal(
        (await provider.getBalance(user))
          .add(gasUsed)
          .sub(startETHBalance)
          .toString(),
        BigNumber.from("1889999999999999999")
      );
    });

    it("should revert if not enough shares", async function () {
      await this.vault.depositETH({ value: parseEther("1") });

      await this.vault
        .connect(counterpartySigner)
        .depositETH({ value: parseEther("10") });

      await expect(
        this.vault.withdrawETH(parseEther("1").add(BigNumber.from("1")))
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });
  });
});
