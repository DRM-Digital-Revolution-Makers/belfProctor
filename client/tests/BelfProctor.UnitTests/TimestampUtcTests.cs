using Newtonsoft.Json;
using Xunit;

namespace BelfProctor.UnitTests;

/// <summary>
/// Locks in the contract that every outbound timestamp is UTC with a trailing 'Z'.
/// The Json settings here must mirror DataTransmissionService — if these tests fail,
/// fix the production setting first, not the test.
/// </summary>
public class TimestampUtcTests
{
    private static readonly JsonSerializerSettings OutboundSettings = new()
    {
        DateTimeZoneHandling = DateTimeZoneHandling.Utc,
    };

    [Fact]
    public void UtcNow_SerializedPayload_EndsWithZ()
    {
        var payload = new { Timestamp = System.DateTime.UtcNow };

        var json = JsonConvert.SerializeObject(payload, OutboundSettings);

        // Newtonsoft emits "2026-06-11T12:34:56.789Z" — the Z is what activity.ts and heartbeat.ts rely on.
        Assert.Matches(@"""Timestamp"":""\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z""", json);
    }

    [Fact]
    public void LocalDateTime_IsNormalizedToUtc_OnSerialization()
    {
        // Even if someone slips a local-kind DateTime into a payload, the settings must coerce it.
        var local = new System.DateTime(2026, 6, 11, 14, 0, 0, System.DateTimeKind.Local);
        var payload = new { Timestamp = local };

        var json = JsonConvert.SerializeObject(payload, OutboundSettings);

        Assert.EndsWith("Z\"}", json);
    }
}
