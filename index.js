// main.js
import dotenv from 'dotenv';
import {OpenSeaBot} from "./OpenSeaBot.js";

dotenv.config();

async function main() {
    try {
        const bot = new OpenSeaBot(
            process.env.PRIVATE_KEY,
            process.env.INFURA_URL,
            process.env.OPENSEA_API_KEY,
            {
                buyThreshold: 0.1,
                offerPercentage: 0.8
            }
        );

        // Example: Monitor Cool Cats collection
        await bot.monitorCollection('cool-cats-nft');

        // Alternatively for single operations:
        // await bot.makeOffer(contract, tokenId, offerAmount);
        // await bot.buyNow(contract, tokenId, price);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

main();