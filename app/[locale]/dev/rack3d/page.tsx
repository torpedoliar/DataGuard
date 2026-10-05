import { notFound } from "next/navigation";
import RealismFixture from "@/components/rack3d/realism-fixture";

export default function Rack3DFixturePage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <RealismFixture />;
}
