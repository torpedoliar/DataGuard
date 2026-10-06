import { notFound } from "next/navigation";
import DeviceProfileFixture from "@/components/admin/device-profile-fixture";

export default function DeviceProfileFixturePage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <DeviceProfileFixture />;
}
