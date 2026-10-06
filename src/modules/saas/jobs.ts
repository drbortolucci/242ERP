import { registerJob } from "@/server/jobs/queue";
import { runBillingPolicy } from "./subscription";
import "./data-export";

registerJob("saas.billing_policy", async () => runBillingPolicy());
