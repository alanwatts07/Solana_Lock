import { BN } from "bn.js";
import { Types, GenericStreamClient, getBN, getNumberFromBN } from "@streamflow/stream";
import {
    StreamflowSolana,
    Types,
} from "@streamflow/stream";

const solanaClient = new StreamflowSolana.SolanaStreamClient(
    "https://api.mainnet-beta.solana.com")

const recipients = [
    {
        recipient: "4ih00075bKjVg000000tLdk4w42NyG3Mv0000dc0M00", // Solana recipient address.
        amount: getBN(100, 9), // depositing 100 tokens with 9 decimals mint.
        name: "January Payroll", // The stream name/subject.
        cliffAmount: getBN(10, 9), // amount released on cliff for this recipient
        amountPerPeriod: getBN(1, 9), //amount released every specified period epoch
    },
];
const createStreamParams: Types.ICreateStreamData = {
    recipients: recipients, // Solana recipient address.
    tokenId: "_token-id", // SPL Token mint.
    start: 1643363040, // Timestamp (in seconds) when the stream/token vesting starts.
    period: 1, // Time step (period) in seconds per which the unlocking occurs.
    cliff: 1643363160, // Vesting contract "cliff" timestamp in seconds.
    canTopup: false, // setting to FALSE will effectively create a vesting contract.
    cancelableBySender: true, // Whether or not sender can cancel the stream.
    cancelableByRecipient: false, // Whether or not recipient can cancel the stream.
    transferableBySender: true, // Whether or not sender can transfer the stream.
    transferableByRecipient: false, // Whether or not recipient can transfer the stream.
    automaticWithdrawal: true, // Whether or not a 3rd party (e.g. cron job, "cranker") can initiate a token withdraw/transfer.
    withdrawalFrequency: 10, // Relevant when automatic withdrawal is enabled. If greater than 0 our withdrawor will take care of withdrawals. If equal to 0 our withdrawor will skip, but everyone else can initiate withdrawals.
    partner: null, //  (optional) Partner's wallet address (string | null).
};

const solanaParams = {
    sender: wallet, // SignerWalletAdapter or Keypair of Sender account
    isNative: // [optional] [WILL CREATE A wSOL STREAM] Wether Stream or Vesting should be paid with Solana native token or not
};

try {
    const { txs } = await client.createMultiple(createMultiStreamsParams, solanaParams);
} catch (exception) {
    // handle exception
}
