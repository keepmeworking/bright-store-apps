import { Box, Button, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { BarChart3, Layout, MessageSquare, Video, Home, Settings, Image as ImageIcon } from "lucide-react";
import { PropsWithChildren } from "react";

export const MainLayout = ({ children }: PropsWithChildren) => {
  const router = useRouter();
  const currentPath = router.pathname || "";

  const tabs = [
    { label: "Dashboard", href: "/", icon: Home },
    { label: "Analytics", href: "/analytics", icon: BarChart3 },
    { label: "Widgets", href: "/widgets", icon: Layout },
    { label: "Reviews", href: "/reviews", icon: MessageSquare },
    { label: "Videos", href: "/videos", icon: Video },
    { label: "Media", href: "/media", icon: ImageIcon },
    { label: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100vh" }}>
      {/* Top Navigation Bar */}
      <Box 
        style={{ 
          padding: "12px 32px",
          borderBottom: "1px solid #E6E6E6", 
          backgroundColor: "#fff", 
          position: "sticky", 
          top: 0, 
          zIndex: 100 
        }}
        display="flex" 
        alignItems="center" 
        justifyContent="space-between"
      >
        <Box display="flex" alignItems="center" gap={6}>
            <Text fontWeight="bold" size={5} style={{ color: "#28234A", marginRight: 24 }}>Magic CMS</Text>
            
            <Box display="flex" gap={2}>
              {tabs.map((tab) => {
                const isActive = currentPath === tab.href || (tab.href !== "/" && currentPath && currentPath.startsWith(tab.href));
                return (
                  <Button
                    key={tab.href}
                    variant="tertiary"
                    onClick={() => router.push(tab.href)}
                    style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 8,
                      borderBottom: isActive ? "2px solid #28234A" : "none",
                      borderRadius: 0,
                      paddingBottom: 8,
                      opacity: isActive ? 1 : 0.6,
                      transition: "all 0.2s"
                    }}
                  >
                    <tab.icon size={18} />
                    <Text size={3} fontWeight={isActive ? "bold" : "medium"}>{tab.label}</Text>
                  </Button>
                );
              })}
            </Box>
        </Box>
        
        <Box display="flex" alignItems="center" gap={4}>
           {/* Placeholder for future app-wide controls */}
           <Box style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: "#F0F0F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text size={1}>BC</Text>
           </Box>
        </Box>
      </Box>

      {/* Main Content Area */}
      <Box style={{ flex: 1 }}>
        {children}
      </Box>
    </Box>
  );
};
