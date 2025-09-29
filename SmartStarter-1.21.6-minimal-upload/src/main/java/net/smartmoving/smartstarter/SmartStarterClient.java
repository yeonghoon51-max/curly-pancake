package net.smartmoving.smartstarter;

import net.fabricmc.api.ClientModInitializer;

public class SmartStarterClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        SmartStarter.LOGGER.info("[SmartStarter] Client initialized.");
    }
}
