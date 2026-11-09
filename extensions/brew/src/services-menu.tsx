/**
 * Menu bar command for Homebrew services, and for how many packages can be
 * upgraded.
 *
 * Homebrew has no way to notify us when a service's state changes, so services
 * stay on the command's one-minute `interval`, with an optimistic `mutate`
 * after each action. Upgrades are not polled that often: the list is cached
 * for about 6 hours (`menu-bar-upgrades`), and "Refresh upgrades" fetches
 * immediately. Neither path runs `brew update`.
 *
 * Always render the extra. Returning null removes the services icon.
 */

import { Color, getPreferenceValues, Icon, LaunchType, MenuBarExtra, launchCommand, showHUD } from "@raycast/api";
import {
  ALL_SERVICES,
  applyServiceAction,
  brewServiceIsRunning,
  ensureError,
  getErrorMessage,
  isBrewLockError,
  outdatedFetchFailureCopy,
  runServiceCommand,
  SERVICE_ACTION_COPY,
  type OutdatedResults,
  type Service,
  type ServiceAction,
} from "./utils";
import { useBrewServices } from "./hooks/useBrewServices";
import { useMenuBarUpgrades } from "./hooks/useMenuBarUpgrades";
import { serviceStatusIcon, type ServicesMutate } from "./components/serviceActions";
import { ERROR_ICON, UPDATE_AVAILABLE_ICON, UP_TO_DATE_ICON, WARNING_ICON } from "./components/palette";
import {
  menuBarTitle,
  menuBarTooltip,
  menuBarUpgradeCount,
  menuBarUpgradeNames,
  menuBarUpgradesLabel,
} from "./utils/menu-bar-upgrades";

const MENU_ICON = { source: "services-menubar.svg", tintColor: Color.PrimaryText };

const ACTION_ICONS: Record<ServiceAction, Icon> = {
  start: Icon.Play,
  stop: Icon.Stop,
  restart: Icon.ArrowClockwise,
};

async function handleAction(action: ServiceAction, name: string, mutate: ServicesMutate) {
  const copy = SERVICE_ACTION_COPY[action];
  const target = name === ALL_SERVICES ? "all services" : name;
  try {
    await mutate(runServiceCommand(action, name), {
      optimisticUpdate: (services) => applyServiceAction(services ?? [], action, name),
    });
    await showHUD(`${copy.past} ${target}`);
  } catch (err) {
    await showHUD(`Failed to ${copy.verb.toLowerCase()} ${target}: ${getErrorMessage(ensureError(err))}`);
  }
}

export default function Command() {
  const { showUpgradeCount, greedyUpgrades } = getPreferenceValues<Preferences.ServicesMenu>();
  const { isLoading, data, error, revalidate, mutate } = useBrewServices();
  const upgrades = useMenuBarUpgrades(showUpgradeCount, greedyUpgrades);

  const services = data ?? [];
  const running = services.filter(brewServiceIsRunning);
  // Unknown (still loading, failed with nothing cached, or the preference is
  // off) leaves the title as the service count alone. Zero is a real count.
  const upgradeCount = showUpgradeCount && upgrades.data ? menuBarUpgradeCount(upgrades.data) : undefined;

  return (
    <MenuBarExtra
      icon={MENU_ICON}
      title={menuBarTitle(running.length, upgradeCount)}
      tooltip={menuBarTooltip(running.length, upgradeCount)}
      isLoading={isLoading || upgrades.isLoading}
    >
      <MenuBarExtra.Section title="All Services">
        <MenuBarExtra.Item
          title="Start All"
          icon={ACTION_ICONS.start}
          onAction={() => handleAction("start", ALL_SERVICES, mutate)}
        />
        <MenuBarExtra.Item
          title="Stop All"
          icon={ACTION_ICONS.stop}
          onAction={() => handleAction("stop", ALL_SERVICES, mutate)}
        />
        <MenuBarExtra.Item
          title="Restart All"
          icon={ACTION_ICONS.restart}
          onAction={() => handleAction("restart", ALL_SERVICES, mutate)}
        />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Services">
        {services.map((service) => (
          <ServiceSubmenu key={service.name} service={service} mutate={mutate} />
        ))}
        {error && (
          <MenuBarExtra.Item
            title={isBrewLockError(error) ? "Brew is Busy" : "Failed to fetch services"}
            tooltip={getErrorMessage(error)}
            icon={isBrewLockError(error) ? WARNING_ICON : ERROR_ICON}
            onAction={() => revalidate()}
          />
        )}
        {!isLoading && !error && services.length === 0 && <MenuBarExtra.Item title="No services found" />}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section>
        {showUpgradeCount && upgrades.data && (
          <UpgradesSubmenu results={upgrades.data} onRefresh={() => upgrades.refresh()} />
        )}
        {showUpgradeCount && upgrades.error && (
          <UpgradeFailureItem error={upgrades.error} onRefresh={() => upgrades.refresh()} />
        )}
        {showUpgradeCount && !upgrades.data && !upgrades.error && upgrades.isLoading && (
          <MenuBarExtra.Item title="Checking upgrades…" />
        )}
        <MenuBarExtra.Item
          title="Open Manage Services"
          icon={Icon.AppWindowList}
          onAction={() => launchCommand({ name: "manage-services", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item title="Refresh" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

function UpgradesSubmenu(props: { results: OutdatedResults; onRefresh: () => void }) {
  const count = menuBarUpgradeCount(props.results);
  const names = count > 0 ? menuBarUpgradeNames(props.results) : [];

  return (
    <MenuBarExtra.Submenu
      title={menuBarUpgradesLabel(count)}
      icon={count > 0 ? UPDATE_AVAILABLE_ICON : UP_TO_DATE_ICON}
    >
      {names.map((name, index) => (
        <MenuBarExtra.Item key={`${index}:${name}`} title={name} />
      ))}
      <MenuBarExtra.Item
        title="Open Show Upgrades"
        icon={Icon.AppWindowList}
        onAction={() => launchCommand({ name: "outdated", type: LaunchType.UserInitiated })}
      />
      <MenuBarExtra.Item title="Refresh upgrades" icon={Icon.ArrowClockwise} onAction={props.onRefresh} />
    </MenuBarExtra.Submenu>
  );
}

function UpgradeFailureItem(props: { error: Error; onRefresh: () => void }) {
  const copy = outdatedFetchFailureCopy(props.error);
  return (
    <MenuBarExtra.Item
      title={copy.title}
      tooltip={copy.message}
      icon={isBrewLockError(props.error) ? WARNING_ICON : ERROR_ICON}
      onAction={props.onRefresh}
    />
  );
}

function ServiceSubmenu(props: { service: Service; mutate: ServicesMutate }) {
  const { service, mutate } = props;
  const running = brewServiceIsRunning(service);

  return (
    <MenuBarExtra.Submenu title={service.name} icon={serviceStatusIcon(service.status)}>
      {running ? (
        <MenuBarExtra.Item
          title="Stop"
          icon={ACTION_ICONS.stop}
          onAction={() => handleAction("stop", service.name, mutate)}
        />
      ) : (
        <MenuBarExtra.Item
          title="Start"
          icon={ACTION_ICONS.start}
          onAction={() => handleAction("start", service.name, mutate)}
        />
      )}
      <MenuBarExtra.Item
        title="Restart"
        icon={ACTION_ICONS.restart}
        onAction={() => handleAction("restart", service.name, mutate)}
      />
    </MenuBarExtra.Submenu>
  );
}
