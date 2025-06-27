// opensea-bot.js
import { ethers } from 'ethers';
import { Seaport } from '@opensea/seaport-js';
import { ItemType } from '@opensea/seaport-js/lib/constants.js';
import axios from 'axios';
import {
    WETH_ADDRESS,
    SEAPORT_ADDRESS,
    OPENSEA_API_URL,
    DEFAULT_CONFIG
} from './config.js';

export class OpenSeaBot {
    constructor(privateKey, infuraUrl, openseaApiKey, config = {}) {
        if (!privateKey || !infuraUrl) {
            throw new Error('Missing required constructor parameters');
        }

        // Initialize provider and wallet
        this.provider = new ethers.providers.JsonRpcProvider(infuraUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);

        // Initialize Seaport
        this.seaport = new Seaport(this.wallet, {
            overrides: { contractAddress: SEAPORT_ADDRESS }
        });

        // Configuration
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.maxGasPriceWei = ethers.utils.parseUnits(this.config.maxGasPrice.toString(), 'gwei');
    }

    /**
     * Main monitoring function
     * @param {string} collectionSlug - OpenSea collection slug
     */
    async monitorCollection(collectionSlug) {
        console.log(`🚀 Monitoring new listings for ${collectionSlug}...`);

        while (true) {
            try {
                const listings = await this.fetchNewListings(collectionSlug);

                for (const listing of listings) {
                    if (!listing.asset) continue;

                    const tokenId = listing.asset.token_id;
                    const contract = listing.asset.asset_contract.address;
                    const price = parseFloat(ethers.utils.formatEther(listing.ending_price));

                    console.log(`🔍 Found NFT #${tokenId} for ${price} ETH`);

                    // Auto-buy if below threshold
                    if (price < this.config.buyThreshold) {
                        const result = await this.buyNow(contract, tokenId, price);
                        if (result?.txHash) {
                            console.log(`🛒 Bought NFT! TX: https://etherscan.io/tx/${result.txHash}`);
                        }
                    } else {
                        // Make an offer (percentage of listing)
                        const offerPrice = price * this.config.offerPercentage;
                        const result = await this.makeOffer(contract, tokenId, offerPrice);
                        if (result?.orderHash) {
                            console.log(`🤝 Offer made! View: https://opensea.io/assets/ethereum/${contract}/${tokenId}`);
                        }
                    }
                }

                await this.delay(this.config.pollingInterval);
            } catch (error) {
                console.error('⚠️ Monitoring error:', error.message);
                await this.delay(this.config.errorRetryDelay);
            }
        }
    }

    /**
     * Fetches new listings from a collection
     * @param {string} collectionSlug - OpenSea collection slug
     * @param {number} limit - Number of listings to fetch
     */
    async fetchNewListings(collectionSlug, limit = 10) {
        try {
            const response = await axios.get(`${OPENSEA_API_URL}/events`, {
                params: {
                    collection_slug: collectionSlug,
                    event_type: 'created',
                    limit: limit
                },
                headers: {
                    'X-API-KEY': this.openseaApiKey
                }
            });
            return response.data.asset_events || [];
        } catch (error) {
            console.error('Failed to fetch listings:', error.message);
            return [];
        }
    }

    /**
     * Buys an NFT immediately
     * @param {string} assetContract - NFT contract address
     * @param {string} tokenId - NFT token ID
     * @param {number} priceEth - Price in ETH
     */
    async buyNow(assetContract, tokenId, priceEth) {
        try {
            // 1. Get the order from OpenSea
            const order = await this.fetchListingOrder(assetContract, tokenId);
            if (!order) throw new Error('No valid order found');

            // 2. Validate the order
            const { isValid } = await this.seaport.validate([order.protocol_data], this.wallet.address);
            if (!isValid) throw new Error('Invalid order');

            // 3. Prepare fulfillment
            const { actions } = await this.seaport.fulfillOrder({
                order: order.protocol_data,
                accountAddress: this.wallet.address,
            });

            // 4. Execute transaction
            const transaction = await actions[0].transactionMethods.buildTransaction();

            // Set gas parameters
            const currentGasPrice = await this.provider.getGasPrice();
            if (currentGasPrice.gt(this.maxGasPriceWei)) {
                throw new Error(`Gas price too high (${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei)`);
            }

            transaction.gasPrice = currentGasPrice;
            transaction.gasLimit = ethers.BigNumber.from(300000);

            // 5. Send transaction
            const txResponse = await this.wallet.sendTransaction(transaction);
            const receipt = await txResponse.wait();

            if (receipt.status === 0) throw new Error('Transaction failed');

            return {
                txHash: txResponse.hash,
                nftId: tokenId,
                price: priceEth
            };

        } catch (error) {
            console.error('BuyNow error:', error.message);
            throw error;
        }
    }

    /**
     * Makes an offer on an NFT
     * @param {string} assetContract - NFT contract address
     * @param {string} tokenId - NFT token ID
     * @param {number} offerAmountEth - Offer amount in ETH
     * @param {number} expirationDays - Offer expiration in days (default: 7)
     */
    async makeOffer(assetContract, tokenId, offerAmountEth, expirationDays = 7) {
        try {
            const offerAmountWei = ethers.utils.parseEther(offerAmountEth.toString());

            // 1. Ensure WETH balance
            await this.wrapEthIfNeeded(offerAmountWei);

            // 2. Approve Seaport to spend WETH
            await this.approveWeth(offerAmountWei);

            // 3. Get royalty info
            const royaltyInfo = await this.getRoyaltyInfo(assetContract) || {
                recipient: '0x0000a26b00c1F0DF003000390027140000fAa719',
                basisPoints: 1000
            };

            // 4. Create offer
            const endTime = Math.floor(Date.now() / 1000) + (expirationDays * 86400);
            const { executeAllActions } = await this.seaport.createOrder({
                offer: [
                    {
                        itemType: ItemType.ERC20,
                        token: WETH_ADDRESS,
                        amount: offerAmountWei.toString()
                    }
                ],
                consideration: [
                    {
                        itemType: ItemType.ERC721,
                        token: assetContract,
                        identifier: tokenId,
                        recipient: this.wallet.address
                    },
                    {
                        itemType: ItemType.ERC20,
                        token: WETH_ADDRESS,
                        amount: (offerAmountWei.mul(royaltyInfo.basisPoints).div(10000)).toString(),
                        recipient: royaltyInfo.recipient
                    }
                ],
                endTime
            }, this.wallet.address);

            // 5. Sign and post offer
            const order = await executeAllActions();
            const orderHash = await this.postOfferToOpenSea(order);

            return {
                orderHash,
                offerAmount: offerAmountEth,
                expiration: new Date(endTime * 1000)
            };

        } catch (error) {
            console.error('MakeOffer error:', error.message);
            throw error;
        }
    }

    // ===== Helper Methods ===== //

    async fetchListingOrder(assetContract, tokenId) {
        try {
            const response = await axios.get(`${OPENSEA_API_URL}/asset/${assetContract}/${tokenId}/listings`, {
                headers: { 'X-API-KEY': this.openseaApiKey }
            });
            return response.data.orders?.[0];
        } catch (error) {
            console.error('Error fetching order:', error.message);
            return null;
        }
    }

    async wrapEthIfNeeded(requiredWei) {
        const wethContract = new ethers.Contract(
            WETH_ADDRESS,
            ['function deposit() payable', 'function balanceOf(address) view returns (uint)'],
            this.wallet
        );

        const wethBalance = await wethContract.balanceOf(this.wallet.address);
        if (wethBalance.lt(requiredWei)) {
            const ethToWrap = requiredWei.sub(wethBalance);
            const tx = await wethContract.deposit({ value: ethToWrap });
            await tx.wait();
            console.log(`💰 Wrapped ${ethers.utils.formatEther(ethToWrap)} ETH to WETH`);
        }
    }

    async approveWeth(amountWei) {
        const wethContract = new ethers.Contract(
            WETH_ADDRESS,
            ['function approve(address,uint) returns (bool)', 'function allowance(address,address) view returns (uint)'],
            this.wallet
        );

        const currentAllowance = await wethContract.allowance(this.wallet.address, SEAPORT_ADDRESS);
        if (currentAllowance.lt(amountWei)) {
            const tx = await wethContract.approve(SEAPORT_ADDRESS, amountWei);
            await tx.wait();
            console.log(`🔏 Approved ${ethers.utils.formatEther(amountWei)} WETH for Seaport`);
        }
    }

    async getRoyaltyInfo(contractAddress) {
        try {
            const response = await axios.get(
                `${OPENSEA_API_URL}/asset_contract/${contractAddress}`,
                { headers: { 'X-API-KEY': this.openseaApiKey } }
            );
            return {
                recipient: response.data.payout_address,
                basisPoints: response.data.dev_seller_fee_basis_points
            };
        } catch {
            return null;
        }
    }

    async postOfferToOpenSea(order) {
        const response = await axios.post(
            `${OPENSEA_API_URL}/v2/orders/ethereum/seaport/offers`,
            order,
            { headers: { 'X-API-KEY': this.openseaApiKey } }
        );
        return response.data.order_hash;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}