const assert = require("assert");
const anchor = require("@project-serum/anchor");
const common = require("@project-serum/common");
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  u64,
  NATIVE_MINT,
  transfer,
} = require("@solana/spl-token");
const {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  Connection,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const { decode } = require("./layout");
const { SystemProgram, Keypair } = anchor.web3;
const { BN } = anchor;

// The stream recipient main wallet
const recipient = Keypair.generate();

const STREAMFLOW_TREASURY = new PublicKey(
  "Ht5G1RhkcKnpLVLMhqJc5aqZ4wYUEbxbtZwGCVbgU7DL"
);

describe("timelock", () => {
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Timelock;
  const sender = provider.wallet;

  const metadata = Keypair.generate();
  const MINT_DECIMALS = 8;
  let escrowTokens;
  let recipientTokens;
  let streamflowTreasuryTokens;
  let nonce;
  let mint;
  let senderTokens;
  let vault;

  // Divide by 1000 since Unix timestamp is seconds
  let start = new BN(+new Date() / 1000 + 4); //add several seconds to make sure this time is not in the past at the time of program invocation.
  // +60 seconds
  let end = new BN(+new Date() / 1000 + 60);
  // In seconds
  const period = new BN(2);
  // Amount to deposit
  // const depositedAmount = new BN(1337_000_000);
  const depositedAmount = new BN(1337); //1 SOL

  it("Initialize test state", async () => {
    [mint, vault] = await common.createMintAndVault(
      provider,
      new anchor.BN(100_000_000_000),
      undefined,
      MINT_DECIMALS
    );

    senderTokens = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      sender.publicKey
    );

    [escrowTokens, nonce] = await PublicKey.findProgramAddress(
      [Buffer("strm"), metadata.publicKey.toBuffer()],
      program.programId
    );

    console.log("ESCROW TOKENS: ", escrowTokens.toString());

    recipientTokens = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      recipient.publicKey
    );

    streamflowTreasuryTokens = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      STREAMFLOW_TREASURY
    );

    // airdrop to receiver, we'll need it later for transfer recipient fees
    let tx = await program.provider.connection.requestAirdrop(
      recipient.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    console.log("Airdrop transaction: ", tx);

    let recBalance = await program.provider.connection.getBalance(
      recipient.publicKey
    );
    console.log("SOL balance: ", recBalance);

    console.log("Accounts:");
    console.log("sender wallet:", sender.publicKey.toBase58());
    console.log("sender tokens:", senderTokens.toBase58());
    console.log("escrow (metadata):", metadata.publicKey.toBase58());
    console.log("escrow tokens:", escrowTokens.toBase58());
    console.log("recipient wallet:", recipient.publicKey.toBase58());
    console.log("recipient tokens:", recipientTokens.toBase58());
    console.log("mint:", mint.toBase58());
  });

  it("Create Vesting Contract w/out the cliff", async () => {
    console.log("\n\n");
    console.log("metadata:", metadata.publicKey.toBase58());
    console.log("buffer:", metadata.publicKey.toBuffer());

    const token = new Token(
      provider.connection,
      mint,
      TOKEN_PROGRAM_ID,
      provider.wallet.payer
    );
    const senderATAcheck = await token.createAssociatedTokenAccount(
      sender.publicKey
    );
    console.log(
      "sender ATA: ",
      senderATAcheck.toString(),
      senderTokens.toString()
    );
    await token.transfer(
      vault,
      senderATAcheck,
      sender.publicKey,
      [sender],
      100_000
    );
    assert.ok(senderATAcheck.toString() === senderTokens.toString());
    const tx = await program.rpc.create(
      // Order of the parameters must match the ones in the program
      start,
      depositedAmount,
      period,
      new BN(2), // amount_per_period
      start, //cliff
      new BN(0), //cliff amount
      true, // cancelable_by_sender,
      false, // cancelable_by_recipient,
      false, //automatic_withdrawal,
      false, //transferable by sender,
      true, //transferable by recipient,
      true,
      "Didi", // stream name
      {
        accounts: {
          sender: sender.publicKey,
          senderTokens,
          recipient: recipient.publicKey,
          metadata: metadata.publicKey,
          recipientTokens,
          escrowTokens,
          mint,
          rent: SYSVAR_RENT_PUBKEY,
          timelockProgram: program.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          streamflowTreasury: STREAMFLOW_TREASURY,
          streamflowTreasuryTokens: streamflowTreasuryTokens,
          partner: STREAMFLOW_TREASURY,
          partnerTokens: streamflowTreasuryTokens,
          feeOracle: STREAMFLOW_TREASURY,
        },
        signers: [metadata],
        // instructions: [createTransferIX], //before program.rpc.create
      }
    );

    const _escrowTokens = await program.provider.connection.getAccountInfo(
      escrowTokens
    );
    const _senderTokens = await program.provider.connection.getAccountInfo(
      senderTokens
    );

    const _metadata = await program.provider.connection.getAccountInfo(
      metadata.publicKey
    );
    const _escrowTokensData = common.token.parseTokenAccountData(
      _escrowTokens.data
    );
    const _senderTokensData = common.token.parseTokenAccountData(
      _senderTokens.data
    );

    let strm_data = decode(_metadata.data);
    console.log("Raw data:\n", _metadata.data);
    console.log("Stream Data:\n", strm_data);

    console.log(
      "deposited during contract creation: ",
      depositedAmount.toNumber(),
      "saved in deposit data",
      strm_data.net_deposited_amount.toNumber(),
      "Escrow tokens balance",
      _escrowTokensData.amount
    );

    console.log("Stream name: ", strm_data.stream_name);
    let bytesStreamName = new TextEncoder().encode(strm_data.stream_name);
    bytesStreamName = bytesStreamName.slice(4).filter((x) => x !== 0);
    let stream_name = new TextDecoder().decode(bytesStreamName);
    console.log("Stream name: ", stream_name);
    console.log("Bytes literal: ", new TextEncoder().encode("Didi").length);
    console.log(
      "Bytes solana string: ",
      new TextEncoder().encode(strm_data.stream_name).length
    );
    console.log("from strm data:", strm_data.net_deposited_amount.toNumber());
    // assert.ok(depositedAmount.toNumber() === _escrowTokensData.amount);
    assert.ok(
      depositedAmount.toNumber() === strm_data.net_deposited_amount.toNumber()
    );
  });

  it("Top-ups the stream", async () => {
    console.log("Top up:\n");
    const oldEscrowAta = await program.provider.connection.getAccountInfo(
      escrowTokens
    );
    const oldEscrowAmount = common.token.parseTokenAccountData(
      oldEscrowAta.data
    ).amount;
    const topupAmount = new BN(1338);

    const old_metadata = await program.provider.connection.getAccountInfo(
      metadata.publicKey
    );
    let old_strm_data = decode(old_metadata.data);

    console.log("Stream Data:\n", old_strm_data);

    console.log("Old escrow amount", oldEscrowAmount);
    // console.log("\nseed", metadata.publicKey.toBuffer());
    // console.log("metadata", metadata.publicKey.toBase58());
    await program.rpc.topup(topupAmount, {
      accounts: {
        sender: sender.publicKey,
        senderTokens,
        metadata: metadata.publicKey,
        escrowTokens,
        streamflowTreasury: STREAMFLOW_TREASURY,
        streamflowTreasuryTokens: streamflowTreasuryTokens,
        partner: STREAMFLOW_TREASURY,
        partnerTokens: streamflowTreasuryTokens,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [sender.payer],
    });
    const _metadata = await program.provider.connection.getAccountInfo(
      metadata.publicKey
    );
    let metadata_data = decode(_metadata.data);

    let newEscrowAmount = null;
    const newEscrowAta = await program.provider.connection.getAccountInfo(
      escrowTokens
    );

    if (newEscrowAta) {
      newEscrowAmount = common.token.parseTokenAccountData(
        newEscrowAta.data
      ).amount;
    }
    console.log(
      "depositedAmount",
      metadata_data.net_deposited_amount.toNumber()
    );
    console.log(
      "Escrow token balance: previous: ",
      oldEscrowAmount,
      "after: ",
      newEscrowAmount
    );
    console.log(
      "Deposited amount",
      metadata_data.net_deposited_amount.toNumber(),
      "Old deposited amount",
      old_strm_data.net_deposited_amount.toNumber()
    );
    // New state on token acc
    assert.ok(topupAmount.eq(new BN(newEscrowAmount - oldEscrowAmount)));
  }).timeout(4000);

  it("Withdraws from a contract", async () => {
    // With set time out it didn't catch errors???
    setTimeout(async () => {
      console.log("Withdraw:\n");
      console.log("Start:\n", start.toNumber());
      console.log(+new Date());
      console.log("recipient tokens", recipientTokens.toBase58());
      const oldEscrowAta = await program.provider.connection.getAccountInfo(
        escrowTokens
      );
      const oldEscrowAmount = common.token.parseTokenAccountData(
        oldEscrowAta.data
      ).amount;
      const oldRecipientAta = await program.provider.connection.getAccountInfo(
        recipientTokens
      );
      const oldRecipientAmount = common.token.parseTokenAccountData(
        oldRecipientAta.data
      ).amount;
      const withdrawAmount = new BN(4); //2 periods passed.

      console.log(
        "metadata",
        metadata.publicKey.toBase58(),
        "escrow_ata",
        escrowTokens.toBase58()
      );
      console.log("seed", metadata.publicKey.toBuffer());
      console.log("metadata", metadata.publicKey.toBase58());
      await program.rpc.withdraw(withdrawAmount, {
        accounts: {
          authority: recipient.publicKey,
          recipient: recipient.publicKey,
          recipientTokens,
          metadata: metadata.publicKey,
          escrowTokens,
          streamflowTreasury: STREAMFLOW_TREASURY,
          streamflowTreasuryTokens: streamflowTreasuryTokens,
          partner: STREAMFLOW_TREASURY,
          partnerTokens: streamflowTreasuryTokens,
          feeOracle: STREAMFLOW_TREASURY,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [recipient],
      });
      const _metadata = await program.provider.connection.getAccountInfo(
        metadata.publicKey
      );
      let strm_data = decode(_metadata.data);
      console.log("Stream Data:\n", strm_data);

      const newRecipientAta = await program.provider.connection.getAccountInfo(
        recipientTokens
      );
      const newRecipientAmount = common.token.parseTokenAccountData(
        newRecipientAta.data
      ).amount;
      const escrow = await program.provider.connection.getAccountInfo(
        metadata.publicKey
      );
      const data = decode(escrow.data);

      let newEscrowAmount = null;
      const newEscrowAta = await program.provider.connection.getAccountInfo(
        escrowTokens
      );

      if (newEscrowAta) {
        newEscrowAmount = common.token.parseTokenAccountData(
          newEscrowAta.data
        ).amount;
      }
      console.log(
        "depositedAmount",
        depositedAmount.toNumber(),
        "withdrawn",
        withdrawAmount
      );
      console.log(
        "Escrow token balance: previous: ",
        oldEscrowAmount,
        "after: ",
        newEscrowAmount
      );

      console.log(
        "Recipient token balance: previous: ",
        oldRecipientAmount,
        "after: ",
        newRecipientAmount
      );
      assert.ok(withdrawAmount.eq(new BN(oldEscrowAmount - newEscrowAmount)));
      assert.ok(
        withdrawAmount.eq(new BN(newRecipientAmount - oldRecipientAmount))
      );
      assert.ok(data.withdrawn_amount.eq(withdrawAmount));
    }, 7500);
  });

  it("Cancels the stream", async () => {
    setTimeout(async () => {
      const oldBalance = await provider.connection.getBalance(sender.publicKey);
      console.log("\nCancel:\n");
      const oldSenderAta = await program.provider.connection.getAccountInfo(
        senderTokens
      );
      const oldSenderAmount = common.token.parseTokenAccountData(
        oldSenderAta.data
      ).amount;
      const oldEscrowAta = await program.provider.connection.getAccountInfo(
        escrowTokens
      );
      const oldEscrowAmount = common.token.parseTokenAccountData(
        oldEscrowAta.data
      ).amount;
      const oldRecipientAta = await program.provider.connection.getAccountInfo(
        recipientTokens
      );
      const oldRecipientAmount = common.token.parseTokenAccountData(
        oldRecipientAta.data
      ).amount;

      await program.rpc.cancel({
        accounts: {
          authority: sender.publicKey,
          sender: sender.publicKey,
          senderTokens,
          recipient: recipient.publicKey,
          recipientTokens,
          metadata: metadata.publicKey,
          escrowTokens,
          streamflowTreasury: STREAMFLOW_TREASURY,
          streamflowTreasuryTokens: streamflowTreasuryTokens,
          partner: STREAMFLOW_TREASURY,
          partnerTokens: streamflowTreasuryTokens,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        },
        signers: [sender.payer],
      });
      const _metadata = await program.provider.connection.getAccountInfo(
        metadata.publicKey
      );
      let strm_data = decode(_metadata.data);
      console.log("Stream Data:\n", strm_data);

      let newEscrowAmount = 0; // It will stay 0 if closed
      const newEscrowAta = await program.provider.connection.getAccountInfo(
        escrowTokens
      );
      if (newEscrowAta) {
        newEscrowAmount = common.token.parseTokenAccountData(
          newEscrowAta.data
        ).amount;
      }
      const newRecipientAta = await program.provider.connection.getAccountInfo(
        recipientTokens
      );
      const newRecipientAmount = common.token.parseTokenAccountData(
        newRecipientAta.data
      ).amount;
      const newSenderAta = await program.provider.connection.getAccountInfo(
        senderTokens
      );
      const newSenderAmount = common.token.parseTokenAccountData(
        newSenderAta.data
      ).amount;

      console.log("cancel:");
      console.log(
        "old sender",
        oldSenderAmount,
        "old recipient",
        oldRecipientAmount,
        "old escrow",
        oldEscrowAmount
      );
      console.log(
        "new sender",
        newSenderAmount,
        "new recipient",
        newRecipientAmount,
        "new escrow:",
        newEscrowAmount,
        "deposited amount",
        depositedAmount.toNumber()
      );
      const newBalance = await provider.connection.getBalance(sender.publicKey);
      console.log("Returned:", newBalance - oldBalance);
      assert.ok(newEscrowAmount === 0);
      // assert.ok(decode(escrow.data).amount.eq(0));
      assert.ok(
        newRecipientAmount + newSenderAmount - oldSenderAmount ===
          oldEscrowAmount
      );
    }, 15500);
  });

  it("Transfers vesting contract recipient", async () => {
    console.log("\nTransfer: ");
    setTimeout(async () => {
      console.log(
        "time diff (start, transfer): ",
        start.toNumber(),
        +new Date() / 1000
      );

      // const metadata = Keypair.generate();
      // [escrowTokens, nonce] = await PublicKey.findProgramAddress(
      //   [Buffer("strm"), metadata.publicKey.toBuffer()],
      //   program.programId
      // );

      const _metadata = await program.provider.connection.getAccountInfo(
        metadata.publicKey
      );

      let strm_data = decode(_metadata.data);
      console.log("Stream Data:\n", strm_data);
      console.log("Transferring to new recipient");
      // let bytesStreamName = new TextEncoder().encode(strm_data.stream_name);
      // bytesStreamName = bytesStreamName.slice(4).filter((x) => x !== 0);
      // let stream_name = new TextDecoder().decode(bytesStreamName);
      // assert.ok(stream_name === "Stream to transfer");
      // Now transfer recipient
      // let escrow = await program.provider.connection.getAccountInfo(
      //   metadata.publicKey
      // );
      // const oldRecipient = decode(escrow.data).recipient;
      let newRecipient = Keypair.generate();
      let newRecipientTokens = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mint,
        newRecipient.publicKey
      );

      //console.log("old recipient", oldRecipient.toBase58());
      console.log(
        "new recipient",
        newRecipient.publicKey.toBase58(),
        "new recipient ATA:",
        newRecipientTokens.toBase58()
      );

      await program.rpc.transferRecipient({
        // It changes to camel case!
        accounts: {
          authority: recipient.publicKey, // Authorized wallet
          newRecipient: newRecipient.publicKey,
          newRecipientTokens,
          metadata: metadata.publicKey,
          escrowTokens,
          mint,
          rent: SYSVAR_RENT_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          system: SystemProgram.programId,
        },
        signers: [recipient],
      });
      console.log("Update recipient success.");
      let escrow = await program.provider.connection.getAccountInfo(
        metadata.publicKey
      );
      const decoded = decode(escrow.data);
      console.log("parseddd", decode(escrow.data));
      const escrowNewRecipient = decoded.recipient;
      console.log("new recipient: ", decoded.recipient.toBase58());
      const escrowNewRecipientTokens = decoded.recipient_tokens;

      console.log(
        "Transfer: old recipient:",
        recipient.publicKey.toBase58(),
        "new recipient: ",
        escrowNewRecipient.toBase58()
      );
      console.log(
        "Transfer: old recipient:",
        recipient.publicKey.toBase58(),
        "new recipient: ",
        newRecipient.publicKey.toBase58()
      );
      console.log(
        "old recipient tokens:",
        recipientTokens.toBase58(),
        "new recipient tokens: ",
        newRecipientTokens.toBase58(),
        "new recipient tokens",
        escrowNewRecipientTokens.toBase58()
      );
      assert.ok(recipient.publicKey !== escrowNewRecipient);
      assert.ok(
        escrowNewRecipient.toBase58() === newRecipient.publicKey.toBase58()
      );
      assert.ok(
        escrowNewRecipientTokens.toBase58() === newRecipientTokens.toBase58()
      );
    }, 8500);
  });

  it.skip("Creates recurring", async () => {
    console.log("\nRecurring");

    const metadata = Keypair.generate();
    [escrowTokens, nonce] = await PublicKey.findProgramAddress(
      [Buffer("strm"), metadata.publicKey.toBuffer()],
      program.programId
    );

    const streamflowTreasuryTokens = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      STREAMFLOW_TREASURY.publicKey
    );

    const tx = await program.rpc.create(
      start,
      depositedAmount,
      period,
      new BN(0), // release rate (when > 0 - recurring payment)
      new BN(0), //cliff
      new BN(0), //cliff amount
      true, // cancelable_by_sender,
      false, // cancelable_by_recipient,
      false, //automatic_withdrawal,
      false, //transferable by sender,
      true, //transferable by recipient,
      false,
      "Stream NewStream NewStream New", // stream name
      {
        accounts: {
          sender: sender.publicKey,
          senderTokens,
          recipient: recipient.publicKey,
          metadata: metadata.publicKey,
          recipientTokens,
          escrowTokens,
          mint,
          rent: SYSVAR_RENT_PUBKEY,
          timelockProgram: program.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          streamflowTreasury: STREAMFLOW_TREASURY,
          streamflowTreasuryTokens: streamflowTreasuryTokens,
          partner: STREAMFLOW_TREASURY,
          partnerTokens: streamflowTreasuryTokens,
          feeOracle: streamflowTreasuryTokens,
        },
        signers: [metadata],
      }
    );

    const _escrowTokens = await program.provider.connection.getAccountInfo(
      escrowTokens
    );
    const _senderTokens = await program.provider.connection.getAccountInfo(
      senderTokens
    );

    const _metadata = await program.provider.connection.getAccountInfo(
      metadata.publicKey
    );
    const _escrowTokensData = common.token.parseTokenAccountData(
      _escrowTokens.data
    );
    const _senderTokensData = common.token.parseTokenAccountData(
      _senderTokens.data
    );

    let strm_data = decode(_metadata.data);

    console.log("Stream Data:\n", strm_data);

    assert.ok(depositedAmount.toNumber() === _escrowTokensData.amount);
    assert.ok(strm_data.period.eq(new BN(10)));
    console.log("Release rate:", strm_data.release_rate.toNumber());
    assert.ok(strm_data.release_rate.eq(new BN(100)));
  }).timeout(6000);
});
