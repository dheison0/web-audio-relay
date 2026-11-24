import { Box, Card, CardContent, Typography } from "@mui/material";

function SystemLog({ entries }: { entries: string[] }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Log do sistema
        </Typography>
        {entries.length === 0 ? (
          <Typography color="text.secondary">Nenhum evento registrado</Typography>
        ) : (
          <Box
            component="pre"
            sx={{
              m: 0,
              maxHeight: 280,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 12,
            }}
          >
            {entries.join("\n")}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default SystemLog;
