/* exported init enable disable */

'use strict';

const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const Me = ExtensionUtils.getCurrentExtension();
const NetworkManagerAppletOpenSignal = []; // [source, signalId]
const WirelessDeviceOpenSignals = []; // Array of [source, signalId]
const PowerManagementItems = [];
const PowerManagementToggleSignal = []; // [source, signalId]

const PowerManagementState = Object.freeze({
    UNSUPPORTED: Symbol('unsupported'),
    ENABLED: Symbol('enabled'),
    DISABLED: Symbol('disabled'),
});

const PowerSaveState = Object.freeze({
    DEFAULT: 'default',
    IGNORE: 'ignore',
    DISABLE: 'disable',
    ENABLE: 'enable',
});

function init() {
    log('init()');
}

function enable() {
    log('enable()');

    // We wait the network System Menu to be displayed
    const networkManagerApplet = Main.panel.statusArea['aggregateMenu']._network;
    NetworkManagerAppletOpenSignal[0] = networkManagerApplet.menu;
    NetworkManagerAppletOpenSignal[1] = NetworkManagerAppletOpenSignal[0].connect('open-state-changed', (menu, open) => {
        log(`networkManagerApplet: ${open}`);

        if (open) {
            const wirelessDevices = networkManagerApplet._devices['wireless'].devices; // imports.ui.status.network.NMConnectionCategory.WIRELESS is causing warning because not declared as var
            if (wirelessDevices !== null) {
                log(`Iterating on ${wirelessDevices.length} wirelessDevices`);
                // For each wireless device, we listen when its submenu is displayed
                for (let i = 0; i < wirelessDevices.length; i++) {
                    const wirelessDevice = wirelessDevices[i];
                    let separator;
                    let powerManagementToggle;
                    const wirelessDeviceOpenSignalId = wirelessDevice.item.menu.connect('open-state-changed', (wirelessDeviceMenu, wirelessDeviceMenuOpen) => {
                        log(`${wirelessDevice._device.get_iface()}: ${wirelessDeviceMenuOpen}`);

                        if (wirelessDeviceMenuOpen) {
                            const iface = wirelessDevice._device.get_iface();
                            const currentPowerManagementState = getPowerManagementState(iface);

                            if (currentPowerManagementState === PowerManagementState.UNSUPPORTED) {
                                log(`${iface} does not support Power Management`);
                                return;
                            }

                            const connectionName = getConnectionName(iface);
                            if (!connectionName) {
                                log(`${iface} is not connected`);
                                return;
                            }

                            // TODO Instead of not displaying the toggle if it's not supported or not connected, we should display it greyed out with a tooltip explaining why

                            let currentState = currentPowerManagementState === PowerManagementState.ENABLED;

                            // We override current state from iwconfig if the current connection has a specific powersave set
                            const currentPowerSaveState = getPowerSaveState(connectionName);
                            if (currentPowerSaveState === PowerSaveState.ENABLE)
                                currentState = true;
                            else if (currentPowerSaveState === PowerSaveState.DISABLE)
                                currentState = false;

                            separator = new PopupMenu.PopupSeparatorMenuItem();
                            powerManagementToggle = new PopupMenu.PopupSwitchMenuItem('Power Management', currentState);
                            PowerManagementToggleSignal[0] = powerManagementToggle;
                            PowerManagementToggleSignal[1] = powerManagementToggle.connect('toggled', toggle => {
                                log(`toggle.state: ${toggle._switch.state}`);
                                GLib.spawn_command_line_sync(`bash -c "nmcli connection modify id "${connectionName}" 802-11-wireless.powersave ${toggle._switch.state ? '3' : '2'}"`);
                                GLib.spawn_command_line_sync(`bash -c "nmcli connection down id "${connectionName}""`);
                                GLib.spawn_command_line_async(`bash -c "nmcli --wait 1 connection up id "${connectionName}""`);
                            });

                            wirelessDeviceMenu.addMenuItem(separator);
                            wirelessDeviceMenu.addMenuItem(powerManagementToggle);

                            PowerManagementItems.push(separator);
                            PowerManagementItems.push(powerManagementToggle);
                        } else {
                            destroyPowerManagementItems();
                        }
                    });

                    WirelessDeviceOpenSignals.push([wirelessDevice.item.menu, wirelessDeviceOpenSignalId]);
                    log(`wirelessDeviceOpenSignals[${i}]: ${wirelessDeviceOpenSignalId}`);
                }
            }
        } else {
            while (WirelessDeviceOpenSignals.length > 0) {
                const wirelessDeviceOpenSignal = WirelessDeviceOpenSignals.pop();
                wirelessDeviceOpenSignal[0].disconnect(wirelessDeviceOpenSignal[1]);
                wirelessDeviceOpenSignal[0] = null;
                log(`disconnect wirelessDeviceOpenSignal ${wirelessDeviceOpenSignal[1]}`);
            }

            destroyPowerManagementItems();
        }
    });

    log(`networkManagerAppletOpenSignal: ${NetworkManagerAppletOpenSignal[1]}`);
}

function disable() {
    log('disable()');

    NetworkManagerAppletOpenSignal[0].disconnect(NetworkManagerAppletOpenSignal[1]);
    NetworkManagerAppletOpenSignal[0] = null;
    log(`disconnect networkManagerAppletOpenSignal ${NetworkManagerAppletOpenSignal[1]}`);

    destroyPowerManagementItems();
}

function getPowerManagementState(iface) {
    // eslint-disable-next-line no-unused-vars
    let [ok, out, err, exit] = GLib.spawn_command_line_sync(`bash -c "iwconfig ${iface} | grep 'Power Management'"`);
    if (out.length) {
        let powerManagementLine = ByteArray.toString(out);
        log(`getPowerManagementState: ${powerManagementLine}`);
        if (powerManagementLine.endsWith(':on\n'))
            return PowerManagementState.ENABLED;

        return PowerManagementState.DISABLED;
    }

    return PowerManagementState.UNSUPPORTED;
}

function getConnectionName(iface) {
    // eslint-disable-next-line no-unused-vars
    let [ok, out, err, exit] = GLib.spawn_command_line_sync(`bash -c "nmcli -g GENERAL.CONNECTION device show ${iface}"`);
    if (out.length) {
        let connectionName = ByteArray.toString(out).trim();
        log(`getConnectionName: ${connectionName}`);
        return connectionName;
    }

    return '';
}

function getPowerSaveState(connectionName) {
    if (connectionName) {
        // eslint-disable-next-line no-unused-vars
        let [ok, out, err, exit] = GLib.spawn_command_line_sync(`bash -c "nmcli -g 802-11-wireless.powersave connection show id "${connectionName}""`);
        if (out.length) {
            let powerSaveState = ByteArray.toString(out);
            log(`getPowerSaveState: ${powerSaveState}`);
            return powerSaveState;
        }
    }

    return PowerSaveState.DEFAULT;
}

function destroyPowerManagementItems() {
    if (PowerManagementToggleSignal[0]) {
        PowerManagementToggleSignal[0].disconnect(PowerManagementToggleSignal[1]);
        PowerManagementToggleSignal[0] = null;
    }

    while (PowerManagementItems.length > 0) {
        const powerManagementItem = PowerManagementItems.pop();
        powerManagementItem.destroy();
    }
}

function log(text) {
    global.log(`${Me.metadata.name}: [INFO] ${text}`);
}
