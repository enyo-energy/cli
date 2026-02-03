import { EnergyApp } from "@enyo-energy/energy-app-sdk";

const client = new EnergyApp();

client.register((packageName: string, version: number) => {
    console.log(`network state is ${client.isOnline() ? 'online' : 'offline'}. Package ${packageName} version ${version} is registered.`);
    client.shutdown(async () => {
        console.log('Shutting down gracefully...');
    })
});
