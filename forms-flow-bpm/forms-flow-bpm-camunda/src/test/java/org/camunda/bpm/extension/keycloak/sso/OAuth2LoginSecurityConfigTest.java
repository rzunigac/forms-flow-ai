package org.camunda.bpm.extension.keycloak.sso;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.camunda.bpm.engine.IdentityService;
import org.camunda.bpm.extension.keycloak.rest.RestApiSecurityConfigurationProperties;
import org.camunda.bpm.extension.keycloak.rest.KeycloakAuthenticationFilter;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.ApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * OAuth2 Login Security Config Test.
 * Checks that the REST filter receives the client-auth and multi-tenancy flags
 * in the right constructor positions.
 */
public class OAuth2LoginSecurityConfigTest {

	@SuppressWarnings("rawtypes")
	@ParameterizedTest
	@CsvSource({ "true,false", "false,true", "true,true", "false,false" })
	public void keycloakAuthenticationFilterKeepsFlagsApart(boolean enableClientAuth, boolean enableMultiTenancy) {
		RestApiSecurityConfigurationProperties configProps = mock(RestApiSecurityConfigurationProperties.class);
		when(configProps.getProvider()).thenReturn("keycloak");
		Environment environment = mock(Environment.class);
		when(environment.getRequiredProperty("spring.security.oauth2.client.provider.keycloak.user-name-attribute"))
				.thenReturn("preferred_username");
		ApplicationContext applicationContext = mock(ApplicationContext.class);
		when(applicationContext.getEnvironment()).thenReturn(environment);

		OAuth2LoginSecurityConfig config = new OAuth2LoginSecurityConfig();
		ReflectionTestUtils.setField(config, "configProps", configProps);
		ReflectionTestUtils.setField(config, "applicationContext", applicationContext);
		ReflectionTestUtils.setField(config, "identityService", mock(IdentityService.class));
		ReflectionTestUtils.setField(config, "clientService", mock(OAuth2AuthorizedClientService.class));
		ReflectionTestUtils.setField(config, "enableClientAuth", enableClientAuth);
		ReflectionTestUtils.setField(config, "enableMultiTenancy", enableMultiTenancy);

		FilterRegistrationBean registration = config.keycloakAuthenticationFilter();
		KeycloakAuthenticationFilter filter = (KeycloakAuthenticationFilter) registration.getFilter();

		assertEquals(enableClientAuth, ReflectionTestUtils.getField(filter, "enableClientAuth"));
		assertEquals(enableMultiTenancy, ReflectionTestUtils.getField(filter, "enableMultiTenancy"));
	}
}
