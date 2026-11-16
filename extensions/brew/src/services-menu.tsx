/**
 * Menu bar command for Homebrew services, and for how many packages can be
 * upgraded.
 *
 * Homebrew has no way to notify us when a service's state changes, so services
 * stay on the command's one-minute `interval`, with an optimistic `mutate`
 * after each action. Upgrades are not polled that often: the list is cached
 * for about 1 hour (`menu-bar-upgrades`), and "Refresh upgrades" fetches
 * immediately. Neither path runs `brew update`. Service names stay on the
 * first screen. Start, Stop, Restart, and Manage Services live in All
 * Services. Pending packages share one Upgrades section: Formulae and Casks
 * are headings, each name upgrades that package, and All Upgrades holds
 * Upgrade All and Preview Upgrades, then Show Upgrades below the line.
 * Pinned packages are not counted and sit in one Pinned submenu at the end of
 * the section. At zero the section is Upgrades and Up to date is the only row
 * besides Pinned. Refresh stays alone in the footer when upgrades are
 * pending. Turning the upgrade count off drops the Upgrades section.
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
  type OutdatedCask,
  type OutdatedFormula,
  type OutdatedResults,
  type Service,
  type ServiceAction,
} from "./utils";
import { useBrewServices } from "./hooks/useBrewServices";
import { useMenuBarUpgrades } from "./hooks/useMenuBarUpgrades";
import { prepareUpgrade } from "./components/actions";
import { queueMenuUpgrade } from "./utils/menu-upgrade";
import { readLiveRun, requestCancel, type UpgradeRunPackage, type UpgradeRunRecord } from "./utils/upgrade-run";
import { serviceStatusIcon, type ServicesMutate } from "./components/serviceActions";
import {
  ERROR_ICON,
  IN_PROGRESS_ICON,
  UPDATE_AVAILABLE_ICON,
  UP_TO_DATE_ICON,
  WARNING_ICON,
} from "./components/palette";
import {
  menuBarServicesSectionTitle,
  menuBarPinnedCount,
  menuBarPinnedTitle,
  menuBarTitle,
  menuBarTooltip,
  menuBarUpgradeCount,
  menuBarUpgradesSectionTitle,
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
  const errored = services.filter((service) => service.status === "error");
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
      <MenuBarExtra.Section title="Services">
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

        <MenuBarExtra.Item title={menuBarServicesSectionTitle(running.length, errored.length)} />
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

      {showUpgradeCount && (
        <UpgradesSection
          results={upgrades.data}
          error={upgrades.error}
          isLoading={upgrades.isLoading}
          onReload={() => upgrades.refresh()}
          liveRun={upgrades.liveRun}
        />
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
          icon={Icon.Repeat}
          onAction={async () => {
            // Return the promise. A click closes the menu and unloads the
            // command; without the await the outdated fetch dies and the
            // one-hour snapshot stays on screen. Services run after, so the
            // two brew processes do not take Homebrew's lock from each other.
            // A live upgrade holds the brew lock. Refresh services, and leave
            // the upgrade list until that run finishes.
            if (showUpgradeCount && !upgrades.liveRun) {
              await upgrades.refresh();
            }
            await revalidate();
          }}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

function UpgradesSection(props: {
  results: OutdatedResults | undefined;
  error: Error | undefined;
  isLoading: boolean;
  onReload: () => Promise<void>;
  liveRun?: UpgradeRunRecord;
}) {
  const count = props.results ? menuBarUpgradeCount(props.results) : 0;
  const sharedNames = new Set(
    (props.results?.formulae ?? [])
      .filter((formula) => props.results?.casks.some((cask) => cask.name === formula.name))
      .map((formula) => formula.name),
  );
  const pinned = props.results && menuBarPinnedCount(props.results) > 0 && (
    <PinnedSubmenu results={props.results} sharedNames={sharedNames} onReload={props.onReload} />
  );
  if (props.results && count > 0) {
    const formulae = props.results.formulae.filter((formula) => !formula.pinned);
    const casks = props.results.casks.filter((cask) => !cask.pinned);
    return (
      <MenuBarExtra.Section title={menuBarUpgradesSectionTitle(count)}>
        {props.error && <UpgradeFailureItem error={props.error} onRefresh={props.onReload} />}
        <MenuBarExtra.Submenu title="All Upgrades">
          {props.liveRun ? (
            <>
              <MenuBarExtra.Item title="Upgrade in progress" icon={IN_PROGRESS_ICON} />
              <MenuBarExtra.Item
                title="Cancel Upgrade"
                icon={Icon.XMarkCircle}
                onAction={() => {
                  const id = props.liveRun?.id;
                  if (id) void requestCancel(id);
                }}
              />
            </>
          ) : (
            <MenuBarExtra.Item
              title="Upgrade All"
              icon={Icon.ArrowUpCircle}
              onAction={() => {
                if (props.results) void upgradeEverything(props.results, props.onReload);
              }}
            />
          )}
          <MenuBarExtra.Item
            title="Preview Upgrades"
            icon={Icon.Eye}
            onAction={() =>
              launchCommand({
                name: "outdated",
                type: LaunchType.UserInitiated,
                context: { mode: "preview-all", outdated: props.results },
              })
            }
          />
          <MenuBarExtra.Section>
            <MenuBarExtra.Item
              title="Show Upgrades"
              icon={Icon.AppWindowList}
              onAction={() => launchCommand({ name: "outdated", type: LaunchType.UserInitiated })}
            />
          </MenuBarExtra.Section>
        </MenuBarExtra.Submenu>

        {formulae.length > 0 && <MenuBarExtra.Item title="Formulae" />}
        {formulae.map((formula) => (
          <PackageUpgradeSubmenu
            key={`formula:${formula.name}`}
            item={formula}
            kind="formula"
            title={sharedNames.has(formula.name) ? `${formula.name} (formula)` : formula.name}
            onReload={props.onReload}
            upgrading={packageStatus(props.liveRun, formula.name, false) === "upgrading"}
          />
        ))}

        {casks.length > 0 && <MenuBarExtra.Item title="Casks" />}
        {casks.map((cask) => (
          <PackageUpgradeSubmenu
            key={`cask:${cask.name}`}
            item={cask}
            kind="cask"
            title={sharedNames.has(cask.name) ? `${cask.name} (cask)` : cask.name}
            onReload={props.onReload}
            upgrading={packageStatus(props.liveRun, cask.name, true) === "upgrading"}
          />
        ))}
        {pinned}
      </MenuBarExtra.Section>
    );
  }
  const upToDate = Boolean(props.results && !props.error);
  const failed = Boolean(props.error);
  const checking = !props.results && !props.error && props.isLoading;
  if (!upToDate && !failed && !checking) {
    return null;
  }
  return (
    <MenuBarExtra.Section title="Upgrades">
      {upToDate && <MenuBarExtra.Item title="Up to date" icon={UP_TO_DATE_ICON} />}
      {failed && props.error && <UpgradeFailureItem error={props.error} onRefresh={props.onReload} />}
      {checking && <MenuBarExtra.Item title="Checking upgrades…" />}
      {pinned}
    </MenuBarExtra.Section>
  );
}

/** Pinned packages are outdated but not pending: brew will not upgrade them until unpinned. */
function PinnedSubmenu(props: { results: OutdatedResults; sharedNames: Set<string>; onReload: () => Promise<void> }) {
  const formulae = props.results.formulae.filter((formula) => formula.pinned);
  const casks = props.results.casks.filter((cask) => cask.pinned);
  return (
    <MenuBarExtra.Submenu title={menuBarPinnedTitle(formulae.length + casks.length)} icon={Icon.Tack}>
      {formulae.map((formula) => (
        <PackageUpgradeSubmenu
          key={`formula:${formula.name}`}
          item={formula}
          kind="formula"
          title={props.sharedNames.has(formula.name) ? `${formula.name} (formula)` : formula.name}
          onReload={props.onReload}
        />
      ))}
      {casks.map((cask) => (
        <PackageUpgradeSubmenu
          key={`cask:${cask.name}`}
          item={cask}
          kind="cask"
          title={props.sharedNames.has(cask.name) ? `${cask.name} (cask)` : cask.name}
          onReload={props.onReload}
        />
      ))}
    </MenuBarExtra.Submenu>
  );
}

function packageStatus(
  run: UpgradeRunRecord | undefined,
  name: string,
  isCask: boolean,
): UpgradeRunPackage["status"] | undefined {
  return run?.packages.find((pkg) => pkg.name === name && pkg.isCask === isCask)?.status;
}

function PackageUpgradeSubmenu(props: {
  item: OutdatedFormula | OutdatedCask;
  kind: "formula" | "cask";
  title: string;
  onReload: () => Promise<void>;
  upgrading?: boolean;
}) {
  const version = versionLabel(props.item);
  if (props.upgrading) {
    return (
      <MenuBarExtra.Submenu title={props.title} icon={IN_PROGRESS_ICON}>
        <MenuBarExtra.Item title="Upgrading" />
      </MenuBarExtra.Submenu>
    );
  }
  return (
    <MenuBarExtra.Submenu title={props.title} icon={props.item.pinned ? Icon.Tack : UPDATE_AVAILABLE_ICON}>
      {props.item.pinned ? (
        <MenuBarExtra.Item title={version ? `Pinned ${version}` : "Pinned"} icon={Icon.Tack} tooltip="Pinned" />
      ) : (
        <MenuBarExtra.Item
          title={version ? `Upgrade ${version}` : "Upgrade"}
          icon={Icon.ArrowUpCircle}
          onAction={() => upgradePackage(props.item, props.kind, props.onReload)}
        />
      )}
      <MenuBarExtra.Item
        title="Preview Upgrade"
        icon={Icon.Eye}
        onAction={() =>
          launchCommand({
            name: "outdated",
            type: LaunchType.UserInitiated,
            context: { mode: "preview", target: props.item },
          })
        }
      />
    </MenuBarExtra.Submenu>
  );
}

function versionLabel(item: OutdatedFormula | OutdatedCask): string | undefined {
  const from = item.installed_versions[0];
  const to = item.current_version;
  return from && to ? `${from} → ${to}` : undefined;
}

function toRunPackage(
  item: OutdatedFormula | OutdatedCask,
  isCask: boolean,
  status?: UpgradeRunPackage["status"],
): UpgradeRunPackage {
  return {
    name: item.name,
    isCask,
    from: item.installed_versions[0],
    to: item.current_version,
    pinned: item.pinned,
    status,
  };
}

async function launchQueuedUpgrade(): Promise<void> {
  await launchCommand({ name: "run-upgrade", type: LaunchType.Background });
}

async function upgradePackage(
  item: OutdatedFormula | OutdatedCask,
  kind: "formula" | "cask",
  onReload: () => Promise<void>,
) {
  const isCask = kind === "cask";
  const live = await readLiveRun();
  // A live run wins before the pin and trust questions. Those belong to the
  // click; the worker cannot ask them.
  const prepared = live ? undefined : await prepareUpgrade(item, { allowUnpin: false });
  const decision = await queueMenuUpgrade(
    {
      live,
      scope: "one",
      prepare: prepared,
      selection: [{ name: item.name, isCask }],
      packages: [toRunPackage(item, isCask, "upgrading")],
    },
    launchQueuedUpgrade,
  );
  if (decision.hud) await showHUD(decision.hud);
  if (decision.refresh) await onReload();
}

async function upgradeEverything(results: OutdatedResults, onReload: () => Promise<void>) {
  const packages = [
    ...results.formulae.map((formula) => toRunPackage(formula, false)),
    ...results.casks.map((cask) => toRunPackage(cask, true)),
  ];
  const decision = await queueMenuUpgrade(
    {
      live: await readLiveRun(),
      scope: "all",
      selection: packages.filter((pkg) => !pkg.pinned).map(({ name, isCask }) => ({ name, isCask })),
      packages: packages.map((pkg) => (pkg.pinned ? pkg : { ...pkg, status: "upgrading" as const })),
    },
    launchQueuedUpgrade,
  );
  if (decision.hud) await showHUD(decision.hud);
  if (decision.refresh) await onReload();
}

function UpgradeFailureItem(props: { error: Error; onRefresh: () => Promise<void> }) {
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
