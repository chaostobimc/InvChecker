package net.invchecker.gui;

import net.minecraft.client.gui.widget.SliderWidget;
import net.minecraft.text.Text;

import java.util.function.Consumer;

/**
 * Slider, der seinen Wert direkt in eine Config-Eigenschaft schreibt.
 */
public final class ValueSliderWidget extends SliderWidget {

	private final double min;
	private final double max;
	private final String format;
	private final Consumer<Double> onChange;

	public ValueSliderWidget(int x, int y, int width, int height, double min, double max,
			double current, String format, Consumer<Double> onChange) {
		super(x, y, width, height, Text.empty(), normalize(current, min, max));
		this.min = min;
		this.max = max;
		this.format = format;
		this.onChange = onChange;
		updateMessage();
	}

	private static double normalize(double current, double min, double max) {
		if (max <= min) {
			return 0.0D;
		}
		return Math.max(0.0D, Math.min(1.0D, (current - min) / (max - min)));
	}

	public double currentValue() {
		return min + value * (max - min);
	}

	@Override
	protected void updateMessage() {
		setMessage(Text.literal(String.format(java.util.Locale.ROOT, format, min + value * (max - min))));
	}

	@Override
	protected void applyValue() {
		onChange.accept(min + value * (max - min));
	}
}
