/**
 * Menu bar command for Homebrew services, and for how many packages can be
 * upgraded.
 *
 * Homebrew has no way to notify us when a service's state changes, so services
 * stay on the command's one-minute `interval`, with an optimistic `mutate`
 * after each action. Upgrades are not polled that often: the list is cached
 * for about 6 hours (`menu-bar-upgrades`), and "Refresh upgrades" fetches
 * immediately. Neither path runs `brew update`. Service names stay on the
 * first screen. Start, Stop, Restart, and Manage Services live in All
 * Services. Pending formulae and casks are listed on the menu, with Upgrade
 * All and Show Upgrades under All Upgrades. Refresh stays in the footer.
 * Turning the upgrade count off drops those rows and Open Show Upgrades.
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
  markOutdatedSnapshotDirty,
  outdatedFetchFailureCopy,
  runServiceCommand,
  SERVICE_ACTION_COPY,
  type OutdatedCask,
  type OutdatedFormula,
  type Service,
  type ServiceAction,
} from "./utils";
import { useBrewServices } from "./hooks/useBrewServices";
import { useMenuBarUpgrades } from "./hooks/useMenuBarUpgrades";
import { upgradeAllPackages, upgradeOnePackage } from "./components/actions";
import { serviceStatusIcon, type ServicesMutate } from "./components/serviceActions";
import { ERROR_ICON, UP_TO_DATE_ICON, WARNING_ICON } from "./components/palette";
import {
  menuBarServicesSectionTitle,
  menuBarTitle,
  menuBarTooltip,
  menuBarUpgradeCount,
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
  const upgradesPending = upgradeCount !== undefined && upgradeCount > 0;

  return (
    <MenuBarExtra
      icon={MENU_ICON}
      title={menuBarTitle(running.length, upgradeCount)}
      tooltip={menuBarTooltip(running.length, upgradeCount)}
      isLoading={isLoading || upgrades.isLoading}
    >
      <MenuBarExtra.Section title={menuBarServicesSectionTitle(running.length)}>
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

      <MenuBarExtra.Submenu title="All Services">
        <MenuBarExtra.Item
          title="Start All Services"
          icon={ACTION_ICONS.start}
          onAction={() => handleAction("start", ALL_SERVICES, mutate)}
        />
        <MenuBarExtra.Item
          title="Stop All Services"
          icon={ACTION_ICONS.stop}
          onAction={() => handleAction("stop", ALL_SERVICES, mutate)}
        />
        <MenuBarExtra.Item
          title="Restart All Services"
          icon={ACTION_ICONS.restart}
          onAction={() => handleAction("restart", ALL_SERVICES, mutate)}
        />
        <MenuBarExtra.Section>
          <MenuBarExtra.Item
            title="Open Manage Services"
            icon={Icon.AppWindowList}
            onAction={() => launchCommand({ name: "manage-services", type: LaunchType.UserInitiated })}
          />
        </MenuBarExtra.Section>
      </MenuBarExtra.Submenu>

      {showUpgradeCount && upgrades.data && upgrades.data.formulae.length > 0 && (
        <MenuBarExtra.Section title="Formulae">
          {upgrades.data.formulae.map((formula) => (
            <MenuBarExtra.Item
              key={`formula:${formula.name}`}
              title={formula.name}
              onAction={() => void upgradePackage(formula, upgrades.refresh)}
            />
          ))}
        </MenuBarExtra.Section>
      )}
      {showUpgradeCount && upgrades.data && upgrades.data.casks.length > 0 && (
        <MenuBarExtra.Section title="Casks">
          {upgrades.data.casks.map((cask) => (
            <MenuBarExtra.Item
              key={`cask:${cask.name}`}
              title={cask.name}
              onAction={() => void upgradePackage(cask, upgrades.refresh)}
            />
          ))}
        </MenuBarExtra.Section>
      )}
      {upgradesPending && (
        <MenuBarExtra.Submenu title="All Upgrades">
          <MenuBarExtra.Item
            title="Upgrade All"
            icon={Icon.ArrowUpCircle}
            onAction={() => void upgradeEverything(upgrades.refresh)}
          />
          <MenuBarExtra.Section>
            <MenuBarExtra.Item
              title="Show Upgrades"
              icon={Icon.AppWindowList}
              onAction={() => launchCommand({ name: "outdated", type: LaunchType.UserInitiated })}
            />
          </MenuBarExtra.Section>
        </MenuBarExtra.Submenu>
      )}
      {showUpgradeCount && upgrades.data && !upgrades.error && upgradeCount === 0 && (
        <MenuBarExtra.Item title="Up to date" icon={UP_TO_DATE_ICON} />
      )}
      {showUpgradeCount && upgrades.error && !upgradesPending && (
        <UpgradeFailureItem error={upgrades.error} onRefresh={() => upgrades.refresh()} />
      )}
      {showUpgradeCount && !upgrades.data && !upgrades.error && upgrades.isLoading && (
        <MenuBarExtra.Item title="Checking upgrades…" />
      )}

      <MenuBarExtra.Section>
        {showUpgradeCount && !upgradesPending && (
          <MenuBarExtra.Item
            title="Open Show Upgrades"
            icon={Icon.AppWindowList}
            onAction={() => launchCommand({ name: "outdated", type: LaunchType.UserInitiated })}
          />
        )}
        <MenuBarExtra.Item
          title="Refresh"
          icon={Icon.ArrowClockwise}
          onAction={() => {
            revalidate();
            if (showUpgradeCount) {
              void upgrades.refresh();
            }
          }}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

async function upgradePackage(item: OutdatedFormula | OutdatedCask, onReload: () => void) {
  const reload = await upgradeOnePackage(item);
  if (!reload) {
    return;
  }
  markOutdatedSnapshotDirty();
  onReload();
}

async function upgradeEverything(onReload: () => void) {
  const reloaded = await upgradeAllPackages();
  if (!reloaded) {
    return;
  }
  markOutdatedSnapshotDirty();
  onReload();
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
