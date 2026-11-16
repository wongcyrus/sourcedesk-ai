# IP addressing

An IPv4 address is a 32-bit identifier normally written as four decimal octets.
A subnet divides an IP network into smaller address ranges.

## Subnet masks

CIDR notation writes the network prefix length after a slash. In
`192.168.10.0/24`, the first 24 bits identify the network and the last 8 bits
identify addresses within it. The subnet mask is `255.255.255.0`.

This range contains 256 addresses. In a conventional IPv4 /24 subnet, the network
address is `192.168.10.0`, the broadcast address is `192.168.10.255`, and host
addresses run from `192.168.10.1` through `192.168.10.254`.

## Default gateway

A host sends traffic for destinations outside its local subnet to a default
gateway, usually a router on the same subnet.

See also [DNS resolution](dns.md#resolution).
