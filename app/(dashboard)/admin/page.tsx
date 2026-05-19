import { getCategories, getDevices } from "@/actions/master-data";
import AddDeviceForm from "@/components/admin/add-device-form";
import DeviceTable from "@/components/admin/device-table";
import PageHeader from "@/components/ui/page-header";
import { verifySession } from "@/lib/session";
import {
  Boxes,
  Building2,
  CircleAlert,
  FolderTree,
  MapPin,
  Network,
  PanelTop,
  Server,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

type Shortcut = {
  href: string;
  label: string;
  meta: string;
  icon: ReactNode;
};

function ShortcutGroup({ title, items }: { title: string; items: Shortcut[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-ops-muted">{title}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md border border-ops-border bg-ops-surface p-3 transition-colors hover:border-ops-accent/45 hover:bg-ops-surface-raised"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ops-accent/12 text-[#b7f5e4]">
                {item.icon}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ops-text">{item.label}</p>
                <p className="text-xs text-ops-muted">{item.meta}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function AdminPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");

  const categories = await getCategories();
  const devices = await getDevices();
  const { getBrands } = await import("@/actions/brands");
  const brands = await getBrands();
  const { getLocations } = await import("@/actions/locations");
  const locations = await getLocations();

  const inventoryShortcuts: Shortcut[] = [
    { href: "/admin/categories", label: "Categories", meta: "Device taxonomy", icon: <FolderTree className="size-5" /> },
    { href: "/admin/brands", label: "Brands", meta: "Vendors and logos", icon: <Tag className="size-5" /> },
    { href: "/admin/locations", label: "Locations", meta: "Rooms and areas", icon: <MapPin className="size-5" /> },
  ];

  const infrastructureShortcuts: Shortcut[] = [
    { href: "/admin/rack-manage", label: "Racks", meta: "Capacity registry", icon: <Boxes className="size-5" /> },
    { href: "/admin/rack", label: "Rack Layout", meta: "Visual placement", icon: <PanelTop className="size-5" /> },
    { href: "/admin/network/vlans", label: "VLANs", meta: "Network segments", icon: <Network className="size-5" /> },
  ];

  const governanceShortcuts: Shortcut[] = [
    { href: "/admin/incidents", label: "Incidents", meta: "Remediation queue", icon: <CircleAlert className="size-5" /> },
    { href: "/admin/users", label: "Users", meta: "Roles and access", icon: <Users className="size-5" /> },
  ];

  if (session.role === "superadmin") {
    governanceShortcuts.push({ href: "/admin/sites", label: "Sites", meta: "Multi-site scope", icon: <Building2 className="size-5" /> });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        eyebrow="Admin / Inventory"
        title="Device Management"
        description={session.activeSiteName ? `Active site: ${session.activeSiteName}` : "Manage data center devices, rack placement, and supporting inventory data."}
        actions={
          <div className="inline-flex items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-sm text-ops-muted">
            <Server className="size-4 text-ops-accent" />
            {devices.length} devices
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <ShortcutGroup title="Inventory" items={inventoryShortcuts} />
        <ShortcutGroup title="Infrastructure" items={infrastructureShortcuts} />
        <ShortcutGroup title="Governance" items={governanceShortcuts} />
      </div>

      <AddDeviceForm categories={categories} brands={brands} locations={locations} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-ops-text">Device List ({devices.length})</h2>
          <p className="text-sm text-ops-muted">Search, filter, sort, remote-manage, and maintain device inventory.</p>
        </div>
        <DeviceTable devices={devices} brands={brands} locations={locations} />
      </section>
    </main>
  );
}
