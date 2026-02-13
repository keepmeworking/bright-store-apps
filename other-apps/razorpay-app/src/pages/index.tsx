
import { NextPage } from "next";
import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { useEffect, useState } from "react";

const IndexPage: NextPage = () => {
  const { appBridge } = useAppBridge();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1 style={{ color: "#2c3e50" }}>Razorpay Integration (Daikcell)</h1>
      <p>This is a standalone Saleor App for processing Razorpay payments.</p>
      
      <div style={{ 
        marginTop: "2rem", 
        padding: "1rem", 
        border: "1px solid #eee", 
        borderRadius: "8px",
        backgroundColor: "#f9f9f9"
      }}>
        <h3>Status</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          <li>✅ App Initialized (Standalone)</li>
          <li>✅ Manifest Configured</li>
          <li>✅ Webhooks Ready (Initialize, Charge, Refund)</li>
        </ul>
      </div>

      <div style={{ marginTop: "2rem", fontSize: "0.8rem", color: "#666" }}>
        <p>Saleor Host: {appBridge?.getState()?.saleorApiUrl || "Not registered"}</p>
      </div>
    </div>
  );
};

export default IndexPage;
