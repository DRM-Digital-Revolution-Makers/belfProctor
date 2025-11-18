using BelfProctor;
using Xunit;

namespace BelfProctor.UnitTests;

public class CommandChannelWorkerTests
{
    [Fact]
    public void BuildWsUrl_Http_ReturnsWs()
    {
        var url = CommandChannelWorker.BuildWsUrl("http://localhost:4000/api", "abc");
        Assert.Equal("ws://localhost:4000/ws?clientId=abc", url);
    }

    [Fact]
    public void BuildWsUrl_Https_DefaultPort_ReturnsWss443()
    {
        var url = CommandChannelWorker.BuildWsUrl("https://example.com/api", "xyz");
        Assert.Equal("wss://example.com:443/ws?clientId=xyz", url);
    }
}